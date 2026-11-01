import {
  EXPORT_MAX_BYTES,
  EXPORT_MAX_LINE_BYTES,
  ExportValidator,
  apiErrorSchema,
} from '@neuron/shared';

import { ApiFailure, request } from './api';
import { accountEpoch, offlineState } from './offline';

export interface PreparedExport {
  blob: Blob;
  filename: string;
  records: number;
}

/** No archive contents enter query caches, IndexedDB, diagnostics or URLs. */
export async function prepareAccountExport(
  accountId: string,
  signal: AbortSignal,
  progress: (bytes: number) => void,
): Promise<PreparedExport> {
  const epoch = accountEpoch();
  const current = () => {
    if (
      signal.aborted ||
      epoch !== accountEpoch() ||
      offlineState().accountId !== accountId ||
      offlineState().signedOut
    )
      throw new Error('export_account');
  };
  current();
  const response = await fetch('/api/account/export', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId }),
    signal,
  });
  current();
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(await response.json().catch(() => undefined));
    throw new ApiFailure({
      code: parsed.success ? parsed.data.error.code : 'unexpected',
      status: response.status,
      correlationId: parsed.success ? parsed.data.error.correlationId : 'export',
    });
  }
  if (!response.body || !response.headers.get('content-type')?.startsWith('application/x-ndjson'))
    throw new Error('export_incomplete');
  const reader = response.body.getReader();
  const validator = new ExportValidator(accountId);
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let pending = '';
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      current();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > EXPORT_MAX_BYTES) throw new Error('export_limit');
      chunks.push(value as Uint8Array<ArrayBuffer>);
      pending += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = pending.indexOf('\n')) >= 0) {
        validator.line(pending.slice(0, newline + 1));
        pending = pending.slice(newline + 1);
      }
      if (pending.length > EXPORT_MAX_LINE_BYTES) throw new Error('export_limit');
      progress(bytes);
    }
    pending += decoder.decode();
    if (pending.length) throw new Error('export_incomplete');
    const manifest = validator.finish();
    // A session can expire, be revoked or change accounts during a long transfer.
    const account = await request<{ id: string }>('/account', { signal });
    current();
    if (account.id !== accountId) throw new Error('export_account');
    return {
      blob: new Blob(chunks, { type: 'application/x-ndjson' }),
      filename: `neuron-export-${manifest.snapshotAt.slice(0, 10)}.jsonl`,
      records: validator.records,
    };
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
