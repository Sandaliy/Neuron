import { apiErrorSchema } from '@neuron/shared';
import type { ApiErrorCode, MessageKey, MessageValues } from '@neuron/shared';

/**
 * Talking to the api.
 *
 * Every path here is relative, and that is the whole design. In production
 * `apps/web/vercel.json` rewrites `/api` to the api deployment; in development
 * the Vite proxy does the same. The browser therefore only ever sees one
 * origin, which is the only reason it agrees to send the session cookie at all.
 *
 * An absolute url to the api deployment would work exactly once, in a test, and
 * then fail for every real person the moment a cookie mattered.
 */

/** Where the api answers, from the browser's point of view. */
export const API_BASE = '/api';

/**
 * What the client can work out on its own, when the api did not say.
 *
 * Separate from the api's own list because the api never sends these: they are
 * conclusions drawn here, about a request that did not arrive or an answer that
 * did not come from the api at all. Keeping them out of the wire contract is
 * what stops a route handler from reaching for one.
 *
 * The three exist because "it failed" is not a diagnosis. A request the network
 * swallowed, an address the server refuses to trust, and a failure nobody
 * predicted need three different things done about them, and the person on
 * screen is the one who has to do it.
 */
export const CLIENT_ERROR_CODES = ['network_unreachable', 'untrusted_origin', 'unexpected'] as const;

export type ClientErrorCode = (typeof CLIENT_ERROR_CODES)[number];

/** Every code a failure on this side can carry. */
export type FailureCode = ApiErrorCode | ClientErrorCode;

/**
 * A refusal from the api, carrying the code rather than a sentence.
 *
 * The sentence is chosen by whatever is rendering, in whichever language is on
 * screen. Nothing in here is ever shown as it stands.
 */
export class ApiFailure extends Error {
  readonly code: FailureCode;
  readonly status: number;
  readonly correlationId: string;
  readonly retryAfterSeconds: number | undefined;
  readonly fields: readonly { readonly path: string; readonly code: string }[];

  constructor(init: {
    code: FailureCode;
    status: number;
    correlationId: string;
    retryAfterSeconds?: number | undefined;
    fields?: readonly { readonly path: string; readonly code: string }[];
  }) {
    // The message is for a log or a stack trace, never for a screen.
    super(`api answered ${init.status} ${init.code}`);

    this.name = 'ApiFailure';
    this.code = init.code;
    this.status = init.status;
    this.correlationId = init.correlationId;
    this.retryAfterSeconds = init.retryAfterSeconds;
    this.fields = init.fields ?? [];
  }
}

/**
 * The message key for a failure, in whatever language is on screen.
 *
 * Every failure reaching a screen is one of three things, and they are told
 * apart here rather than flattened into one apology: the server refused and
 * said why, the request never left the device, or nobody predicted this. The
 * third carries the id the server log is searched by, because "it said
 * something went wrong" is not a bug report and "it said 01a00697" is.
 *
 * @param error whatever was thrown
 * @returns the key and the values its placeholders need
 */
export function describe(error: unknown): { key: MessageKey; values: MessageValues } {
  if (error instanceof ApiFailure) {
    return {
      key: `error.${error.code}` as MessageKey,
      values: {
        seconds: error.retryAfterSeconds ?? 60,
        correlationId: error.correlationId,
      },
    };
  }

  // Not an answer from the api at all: something threw on this side. There is
  // no id to quote, because nothing was ever sent.
  return { key: 'error.unexpected', values: {} };
}

interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly body?: unknown;
  readonly signal?: AbortSignal;
}

/**
 * One request, with the error envelope already unpacked.
 *
 * @param path the path under `/api`, starting with a slash
 * @param options method, body and an abort signal
 * @returns the parsed body
 * @throws ApiFailure when the api refuses, for any reason
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal } = options;

  let response: Response;

  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      // Same origin by definition, so this is belt and braces rather than a
      // requirement. It also documents that these calls carry a session.
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal ? { signal } : {}),
    });
  } catch (cause) {
    // An aborted request is the app tidying up after itself, not a failure to
    // report. Rethrowing it keeps it out of every error state on screen.
    if (cause instanceof DOMException && cause.name === 'AbortError') {
      throw cause;
    }

    /*
     * The request never arrived. No aeroplane mode, a captive portal, a dead
     * tunnel, the deployment restarting: from where the person is sitting
     * these are one event, and it is not the same event as the server
     * answering badly. Saying so is the difference between checking the wifi
     * and waiting for someone else to fix something.
     */
    throw new ApiFailure({
      code: 'network_unreachable',
      status: 0,
      correlationId: 'no-response',
    });
  }

  const text = await response.text();
  let parsed: unknown = undefined;

  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
  }

  if (response.ok) {
    return parsed as T;
  }

  const envelope = apiErrorSchema.safeParse(parsed);

  if (!envelope.success) {
    /*
     * A failure that did not come from the api at all: a proxy timing out, a
     * platform error page, an html body. The status is real, so it is kept, but
     * the code cannot be trusted, and the honest thing to call this is
     * unexpected.
     *
     * Vercel stamps every response it handles with an id of its own, and that
     * id is what the runtime log is searched by. When there is one it stands in
     * for the correlation id the api would have given, so even a failure that
     * never reached our code can be traced to one request.
     */
    const platformId = response.headers.get('x-vercel-id');

    throw new ApiFailure({
      code: platformId === null ? 'unexpected' : 'internal_error',
      status: response.status,
      correlationId: platformId ?? 'no-reference',
    });
  }

  const { code, status, correlationId, details } = envelope.data.error;

  throw new ApiFailure({
    code,
    status,
    correlationId,
    retryAfterSeconds: details?.retryAfterSeconds,
    fields: details?.fields ?? [],
  });
}
