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
 * A refusal from the api, carrying the code rather than a sentence.
 *
 * The sentence is chosen by whatever is rendering, in whichever language is on
 * screen. Nothing in here is ever shown as it stands.
 */
export class ApiFailure extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly correlationId: string;
  readonly retryAfterSeconds: number | undefined;
  readonly fields: readonly { readonly path: string; readonly code: string }[];

  constructor(init: {
    code: ApiErrorCode;
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
 * Anything that is not an `ApiFailure` is a fetch that never arrived: no
 * network, a proxy in the way, the deployment restarting. From where the person
 * is sitting that is the same event as the server not answering, and it says so
 * in their language rather than as `TypeError: Failed to fetch`.
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

  return { key: 'error.service_unavailable', values: {} };
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

    throw new ApiFailure({
      code: 'service_unavailable',
      status: 503,
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
     * the code cannot be trusted and is reported as the one thing that is
     * certainly true, which is that this request did not work.
     */
    throw new ApiFailure({
      code: response.status >= 500 ? 'service_unavailable' : 'invalid_request',
      status: response.status,
      correlationId: 'not-from-the-api',
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
