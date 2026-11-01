import { useEffect, useRef, useState } from 'react';

import type { MessageKey } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { useAccount } from '../../lib/account';
import { prepareAccountExport } from '../../lib/account-export';
import { ApiFailure } from '../../lib/api';
import { hasServerAuthority, useCapabilities } from '../../lib/capabilities';
import { accountEpoch } from '../../lib/offline';
import { Button } from '../../ui/button';
import { Card, GroupLabel } from '../../ui/card';

export function AccountExport() {
  const t = useTranslate();
  const accountId = useAccount().data?.id;
  return accountId ? <ExportForAccount key={accountId} accountId={accountId} t={t} /> : null;
}

function ExportForAccount({
  accountId,
  t,
}: {
  accountId: string;
  t: ReturnType<typeof useTranslate>;
}) {
  const capability = useCapabilities();
  const active = useRef<AbortController | null>(null);
  const resource = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bytes, setBytes] = useState(0);
  const [error, setError] = useState<MessageKey>();
  const [ready, setReady] = useState<{ url: string; file: File; epoch: number }>();
  useEffect(
    () => () => {
      active.current?.abort();
      if (resource.current) URL.revokeObjectURL(resource.current);
    },
    [],
  );

  const prepare = async () => {
    if (!hasServerAuthority() || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    const timeout = setTimeout(() => controller.abort(), 150_000);
    setError(undefined);
    setReady(undefined);
    if (resource.current) {
      URL.revokeObjectURL(resource.current);
      resource.current = null;
    }
    setBytes(0);
    setBusy(true);
    try {
      const prepared = await prepareAccountExport(accountId, controller.signal, setBytes);
      const file = new File([prepared.blob], prepared.filename, { type: prepared.blob.type });
      const url = URL.createObjectURL(file);
      resource.current = url;
      setReady({ url, file, epoch: accountEpoch() });
    } catch (failure) {
      if (active.current === controller)
        setError(
          failure instanceof ApiFailure && failure.status === 401
            ? 'export.expired'
            : failure instanceof Error && failure.message === 'export_limit'
              ? 'export.limit'
              : 'export.failed',
        );
    } finally {
      clearTimeout(timeout);
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  };
  const valid = () => {
    if (ready && ready.epoch === accountEpoch() && hasServerAuthority()) return true;
    setReady(undefined);
    if (resource.current) {
      URL.revokeObjectURL(resource.current);
      resource.current = null;
    }
    setError('export.expired');
    return false;
  };
  const share = async () => {
    if (!ready || !valid()) return;
    try {
      await navigator.share({ files: [ready.file] });
    } catch (failure) {
      if (!(failure instanceof DOMException && failure.name === 'AbortError'))
        setError('export.shareFailed');
    }
  };
  const canShare =
    ready &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [ready.file] });

  return (
    <section className="flex flex-col gap-12" aria-label={t('export.title')}>
      <GroupLabel>{t('export.title')}</GroupLabel>
      <Card className="flex flex-col gap-16">
        <p className="text-15 text-primary">{t('export.scope')}</p>
        <p className="text-14 text-secondary">{t('export.local')}</p>
        <p className="text-14 text-secondary">{t('export.readOnly')}</p>
        <div role="status" aria-live="polite" className="text-14 text-secondary">
          {busy
            ? t('export.progress', { size: (bytes / 1024 / 1024).toFixed(1) })
            : ready
              ? t('export.ready')
              : null}
        </div>
        {error ? (
          <p role="alert" className="text-14 text-error">
            {t(error)}
          </p>
        ) : null}
        {ready ? (
          <>
            <div className="flex flex-wrap gap-12">
              <a
                href={ready.url}
                download={ready.file.name}
                onClick={(event) => {
                  if (!valid()) event.preventDefault();
                }}
                className="inline-flex min-h-44 items-center rounded-12 px-16 font-semibold text-accent focus-visible:outline"
              >
                {t('export.save')}
              </a>
              {canShare ? <Button onClick={() => void share()}>{t('export.share')}</Button> : null}
            </div>
            <p className="text-14 text-secondary">{t('export.saveHint')}</p>
            <p className="text-14 text-secondary">{t('export.private')}</p>
          </>
        ) : null}
        <div className="flex flex-wrap gap-12">
          <Button busy={busy} disabled={!capability.server} onClick={() => void prepare()}>
            {t(error ? 'export.retry' : ready ? 'export.again' : 'export.prepare')}
          </Button>
          {busy ? (
            <Button onClick={() => active.current?.abort()}>{t('common.cancel')}</Button>
          ) : null}
        </div>
        {!capability.server ? (
          <p className="text-14 text-secondary">{t('offline.serverRequired')}</p>
        ) : null}
      </Card>
    </section>
  );
}
