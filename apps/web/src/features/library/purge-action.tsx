import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { useTranslate } from '../../i18n/locale';
import { describe, request } from '../../lib/api';
import { Button } from '../../ui/button';
import { Checkbox } from '../../ui/checkbox';
import { Dialog, DialogBody, DialogFooter } from '../../ui/dialog';
import { useToast } from '../../ui/toast';

interface Impact {
  name: string;
  folders: number;
  decks: number;
  notes: number;
  cards: number;
}

export function PurgeAction({
  target,
  id,
  name,
}: {
  readonly target: 'decks' | 'notes';
  readonly id: string;
  readonly name: string;
}) {
  const t = useTranslate();
  const toast = useToast();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  const impact = useQuery({
    queryKey: ['purge-impact', target, id],
    enabled: open,
    queryFn: () => request<Impact>(`/${target}/${id}/purge-impact`),
    staleTime: 0,
  });
  const purge = useMutation({
    mutationKey: ['purge'],
    onMutate: async () => {
      setOpen(false);
      const key = [target, 'deleted'];
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<Record<string, { id: string }[]>>(key);
      client.setQueryData(
        key,
        previous && { ...previous, [target]: previous[target]?.filter((row) => row.id !== id) },
      );
      return { previous, key };
    },
    mutationFn: () =>
      request<Impact>(`/${target}/${id}/purge`, { method: 'POST', body: { confirmed: true } }),
    onSuccess: () => {
      setOpen(false);
      toast.show(t('deleted.permanentDone'));
    },
    onError: (error, _input, context) => {
      const row = context?.previous?.[target]?.find((item) => item.id === id);
      if (row && context)
        client.setQueryData<Record<string, { id: string }[]>>(
          context.key,
          (current) =>
            current && {
              ...current,
              [target]: [...(current[target] ?? []).filter((item) => item.id !== id), row],
            },
        );
      toast.show(t(describe(error).key, describe(error).values), 'danger');
    },
    onSettled: () => {
      if (client.isMutating({ mutationKey: ['purge'] }) === 1) {
        void client.invalidateQueries({ queryKey: ['decks'] });
        void client.invalidateQueries({ queryKey: ['notes'] });
      }
    },
  });
  const error = purge.error ?? impact.error;
  const exactName = impact.data?.name ?? name;
  return (
    <>
      <Button
        variant="destructive"
        onClick={() => {
          setChecked(false);
          purge.reset();
          setOpen(true);
        }}
      >
        {t('deleted.permanent')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t('deleted.permanentTitle', { name: exactName })}
        dismissable={!purge.isPending}
      >
        <DialogBody>
          <p className="text-14 text-secondary">{t('deleted.permanentBody')}</p>
          {impact.data && (
            <p className="text-14 text-secondary">{t('deleted.impact', { ...impact.data })}</p>
          )}
          {error && (
            <p role="alert" className="text-14 text-error">
              {t(describe(error).key, describe(error).values)}
            </p>
          )}
          <Checkbox checked={checked} onChange={setChecked} disabled={purge.isPending}>
            {t('deleted.permanentCheck')}
          </Checkbox>
        </DialogBody>
        <DialogFooter>
          <Button
            full
            variant="destructive"
            busy={purge.isPending}
            disabled={!checked || !impact.data || impact.isFetching || !!impact.error}
            onClick={() => purge.mutate()}
          >
            {t('deleted.permanent')}
          </Button>
          <Button full variant="text" disabled={purge.isPending} onClick={() => setOpen(false)}>
            {t('common.cancel')}
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
