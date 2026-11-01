import { Hono } from 'hono';
import { stream } from 'hono/streaming';

import { exportRequestSchema } from '@neuron/shared';

import { repositoriesOf, signedIn } from '../context.js';
import { ExportLimit } from '../db/repositories/account-export.js';
import { ApiError } from '../errors.js';
import { readBody } from '../validation.js';

import type { RequestBindings, ServerParts } from '../context.js';

export function accountExportRoutes(parts: ServerParts): Hono<RequestBindings> {
  const routes = new Hono<RequestBindings>();
  routes.post('/export', async (context) => {
    const body = await readBody(context, exportRequestSchema);
    if (body.accountId !== signedIn(context).id) throw new ApiError('not_authenticated');
    context.header('Content-Type', 'application/x-ndjson; charset=utf-8');
    context.header('Content-Disposition', 'attachment; filename="neuron-export.jsonl"');
    const controller = new AbortController();
    const abort = () => controller.abort();
    context.req.raw.signal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, 125_000);
    return stream(context, async (output) => {
      output.onAbort(abort);
      try {
        await repositoriesOf(context).accountExport.write(
          async (line) => {
            // A stalled receiver cannot retain a database snapshot indefinitely.
            let rejectAbort = () => {};
            const cancelled = new Promise<never>((_, reject) => {
              rejectAbort = () => reject(new Error('export_aborted'));
              if (controller.signal.aborted) rejectAbort();
              else controller.signal.addEventListener('abort', rejectAbort, { once: true });
            });
            try {
              await Promise.race([output.write(line), cancelled]);
            } finally {
              controller.signal.removeEventListener('abort', rejectAbort);
            }
          },
          controller.signal,
          async () => {
            const current = await parts.auth.api.getSession({ headers: context.req.raw.headers });
            if (
              !current ||
              current.user.id !== body.accountId ||
              current.session.passwordChangeRequired ||
              (parts.requireVerifiedEmail && !current.user.emailVerified)
            )
              throw new ApiError('not_authenticated');
          },
        );
      } catch (error) {
        // No driver errors, row contents or request bodies enter logs or diagnostics.
        if (!controller.signal.aborted) {
          await output
            .write(
              `${JSON.stringify({ type: 'error', code: error instanceof ExportLimit ? 'export_limit' : 'export_failed' })}\n`,
            )
            .catch(() => undefined);
        }
      } finally {
        clearTimeout(timeout);
        context.req.raw.signal.removeEventListener('abort', abort);
        controller.abort();
      }
    });
  });
  return routes;
}
