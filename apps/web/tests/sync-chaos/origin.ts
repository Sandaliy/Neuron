import { expect } from '@playwright/test';

import { builtShell } from '../live-shell';

import type { HttpBindings } from '../../../api/node_modules/@hono/node-server/dist/index.mjs';
import type { Server } from 'node:http';

type Operation = 'answer' | 'undo' | 'note' | 'create';
type Session = 'owner' | 'expired' | 'other';
type Action = 'drop' | Response | undefined;
type Phase = 'before' | 'after';
type Attempt = { operation: Operation; session: Session; body: string };
type Event = Record<string, string | number>;
export type RecordEvent = (event: Event) => void;

function operationFor(path: string): Operation | undefined {
  if (path === '/api/reviews') return 'answer';
  if (path === '/api/reviews/undo') return 'undo';
  if (/^\/api\/notes\/[^/]+\/offline-edit$/.test(path)) return 'note';
  if (path === '/api/decks/offline-create') return 'create';
  return undefined;
}

export async function startOrigin(
  device: 'A' | 'B',
  apps: Record<Session, { fetch(request: Request): Response | Promise<Response> }>,
  record: RecordEvent,
) {
  const { serve } = await import('../../../api/node_modules/@hono/node-server/dist/index.mjs');
  const attempts: Attempt[] = [];
  const gates: Array<{
    operation: Operation;
    phase: Phase;
    used: boolean;
    enter: (response: Response | undefined) => void;
    action: Promise<Action>;
    release: (action?: Action) => void;
  }> = [];
  let session: Session = 'owner';
  let disconnected = false;
  let stopping = false;
  const active = new Set<Promise<Response>>();

  const fetch = async (request: Request, { outgoing }: HttpBindings): Promise<Response> => {
    const path = new URL(request.url).pathname;
    const drop = () => {
      outgoing.destroy();
      return new Response(null, { status: 503 });
    };
    if (disconnected || stopping) return drop();
    if (!path.startsWith('/api/')) return builtShell(path);

    const selected = session;
    if (path === '/api/auth/sign-in/email' && request.method === 'POST' && selected !== 'expired') {
      record({ device, event: 'fixture-sign-in', session: selected });
      return Response.json({});
    }
    const app = apps[selected];
    const operation = request.method === 'POST' ? operationFor(path) : undefined;
    if (!operation) {
      const response = await app.fetch(request);
      if (path === '/api/account' && selected === 'expired')
        record({ device, event: 'account-validation', session: selected, status: response.status });
      return response;
    }

    const body = await request.clone().text();
    const number = attempts.length + 1;
    attempts.push({ operation, session: selected, body });
    const log = (event: string, extra: Event = {}) =>
      record({ device, event, operation, attempt: number, session: selected, ...extra });
    log('request');
    outgoing.once('close', () => {
      if (!outgoing.writableFinished) log('connection-closed');
    });
    const gate = gates.find((item) => !item.used && item.operation === operation);
    if (gate) gate.used = true;

    const intercept = async (phase: Phase, response?: Response) => {
      if (gate?.phase !== phase) return undefined;
      log('held', { phase });
      gate.enter(response?.clone());
      const action = await gate.action;
      log(action === 'drop' ? 'dropped' : action ? 'replayed-response' : 'released', { phase });
      return action;
    };

    if ((await intercept('before')) === 'drop' || stopping) return drop();
    const response = await app.fetch(request);
    log('route-returned', { status: response.status });
    const action = await intercept('after', response);
    if (action === 'drop' || stopping) return drop();
    const reply = action ?? response;
    outgoing.once('finish', () => log('response-sent', { status: reply.status }));
    return reply;
  };

  const server = serve({
    fetch: (request, bindings) => {
      const http = bindings as HttpBindings;
      // A cut must target this attempt. Chromium can transparently reissue
      // a request when a reused keep-alive socket closes before its reply.
      http.outgoing.shouldKeepAlive = false;
      const pending = fetch(request, http);
      active.add(pending);
      return pending.finally(() => active.delete(pending));
    },
    hostname: '127.0.0.1',
    port: 0,
  }) as Server;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    if (server.listening) resolve();
    else server.once('listening', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a loopback HTTP origin');

  return {
    url: `http://127.0.0.1:${address.port}`,
    attempts,
    disconnect(value: boolean) {
      disconnected = value;
      record({ device, event: value ? 'network-down' : 'network-up' });
    },
    authenticate(value: Session) {
      session = value;
      record({ device, event: 'session-changed', session: value });
    },
    hold(operation: Operation, phase: Phase) {
      const reached = Promise.withResolvers<Response | undefined>();
      const action = Promise.withResolvers<Action>();
      const release = (result?: Action) => action.resolve(result);
      gates.push({
        operation,
        phase,
        used: false,
        enter: reached.resolve,
        action: action.promise,
        release,
      });
      return { reached: reached.promise, release };
    },
    exact(operation: Operation, payloads: object[]) {
      const deliveries = attempts.filter((item) => item.operation === operation);
      expect(
        deliveries.map((item) => JSON.parse(item.body)),
        `${device} ${operation} delivery sequence matches durable intents`,
      ).toEqual(payloads);
      expect(
        deliveries.map((item) => item.session),
        `${device} ${operation} session`,
      ).toEqual(payloads.map(() => 'owner'));
      const firstBytes = new Map<object, string>();
      for (const [index, payload] of payloads.entries()) {
        const body = deliveries[index]!.body;
        expect(
          body === (firstBytes.get(payload) ?? body),
          `${device} ${operation} retry bytes`,
        ).toBe(true);
        firstBytes.set(payload, body);
      }
    },
    async close() {
      stopping = true;
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
      for (const gate of gates) gate.release('drop');
      await Promise.allSettled(active);
      await closed;
    },
  };
}
