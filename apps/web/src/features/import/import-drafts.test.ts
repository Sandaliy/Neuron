import { describe, expect, it, vi } from 'vitest';

import { detectFormat, parseImport } from '@neuron/shared';

import * as collectionDb from '../../lib/collection-db';

import {
  newImportDraft,
  validateImportDraft,
  importDraftVisit,
  saveImportDraft,
} from './import-drafts';
import { createAttempt } from './import-plan';

const visit = vi.hoisted(() => ({ accountId: 'account-a', signedOut: false, epoch: 1 }));
vi.mock('../../lib/offline', () => ({
  offlineState: () => visit,
  accountEpoch: () => visit.epoch,
}));

describe('local Import preparation envelopes', () => {
  it('retains incomplete raw source, unadded fields, mapping and duplicate choices', () => {
    const draft = newImportDraft('account-a', 'deck');
    draft.revision = 1;
    draft.preparation = {
      ...draft.preparation,
      raw: '{unfinished',
      left: 'Unadded',
      right: '',
      mode: 'json',
      format: 'json',
      columns: ['translation', 'term'],
      resolution: 'merge',
      overrides: { 2: 'create' },
    };
    expect(validateImportDraft(structuredClone(draft), 'account-a')).toEqual(draft);
    expect(parseImport(draft.preparation.raw, 'json').failures).not.toHaveLength(0);
  });

  it('refuses foreign accounts, unknown formats and broken storage without treating them as empty', () => {
    const draft = { ...newImportDraft('account-a'), revision: 1 };
    expect(() => validateImportDraft(draft, 'account-b')).toThrow();
    expect(() => validateImportDraft({ ...draft, format: 2 }, 'account-a')).toThrow();
    expect(() => validateImportDraft({ ...draft, preparation: {} }, 'account-a')).toThrow();
    expect(() => validateImportDraft({ ...draft, revision: -1 }, 'account-a')).toThrow();
  });

  it('retains frozen delivery IDs and bounded progress independently of parsed previews', () => {
    const deckId = '01900000-0000-7000-8000-000000000011';
    const draft = { ...newImportDraft('account-a', deckId), revision: 1 };
    const parsed = parseImport('one — first\ntwo — second', 'text');
    const attempt = createAttempt(parsed, [], 'skip', {}, deckId);
    const saved = validateImportDraft({ ...draft, delivery: { attempt, done: 0 } }, 'account-a');
    expect(saved.delivery?.attempt).toEqual(attempt);
    expect(() =>
      validateImportDraft({ ...saved, delivery: { attempt, done: 2 } }, 'account-a'),
    ).toThrow();
    expect(() =>
      validateImportDraft(
        { ...saved, delivery: { attempt: { ...attempt, batchId: 'broken' }, done: 0 } },
        'account-a',
      ),
    ).toThrow();
    expect(() =>
      validateImportDraft(
        {
          ...saved,
          delivery: {
            attempt: {
              ...attempt,
              merge: [{ noteId: '../account', fields: { term: 'one', translation: 'first' } }],
            },
            done: 0,
          },
        },
        'account-a',
      ),
    ).toThrow();
  });

  it('revokes an open preparation visit on sign-out, account switch and a replacement visit', () => {
    const guard = importDraftVisit('account-a');
    expect(guard).not.toThrow();
    visit.signedOut = true;
    expect(guard).toThrow();
    visit.signedOut = false;
    visit.accountId = 'account-b';
    expect(guard).toThrow();
    visit.accountId = 'account-a';
    visit.epoch++;
    expect(guard).toThrow();
  });

  it('keeps a 5,000-row source intact for the existing shared parser', () => {
    const draft = { ...newImportDraft('account-a', 'deck'), revision: 1 };
    draft.preparation.raw = Array.from({ length: 5000 }, (_, i) => `word ${i}\tmeaning ${i}`).join(
      '\n',
    );
    const reopened = validateImportDraft(structuredClone(draft), 'account-a');
    expect(
      parseImport(reopened.preparation.raw, detectFormat(reopened.preparation.raw)).rows,
    ).toHaveLength(5000);
  });

  it('freezes validated identities deeply and still refuses invalid progress on cached plans', () => {
    const deck = '01900000-0000-7000-8000-000000000011';
    const draft = { ...newImportDraft('account-a', deck), revision: 1 };
    const attempt = createAttempt(parseImport('one — first', 'text'), [], 'skip', {}, deck);
    Object.freeze(attempt); // A shallowly frozen input must not make nested values mutable.
    const saved = validateImportDraft({ ...draft, delivery: { attempt, done: 0 } }, 'account-a');
    expect(Object.isFrozen(saved.delivery!.attempt.create[0]!.fields)).toBe(true);
    expect(() =>
      validateImportDraft({ ...saved, delivery: { attempt, done: 2 } }, 'account-a'),
    ).toThrow();
    expect(() =>
      validateImportDraft({ ...saved, delivery: { attempt, done: 1, merged: 1 } }, 'account-a'),
    ).toThrow();
    expect(() =>
      validateImportDraft(
        { ...saved, preparation: { ...saved.preparation, deck: 'another' } },
        'account-a',
      ),
    ).toThrow();
  });

  it('restores previously saved object references after replacement, then checkpoints only the header', async () => {
    const values = new Map<string, unknown>();
    const writes: string[] = [];
    // Exercise the serialization cache independently of native transaction timing,
    // which the quota, upgrade and competing-tab browser journeys cover.
    const store = {
      get(key: string) {
        const request = {
          result: structuredClone(values.get(key)),
          onsuccess: undefined as (() => void) | undefined,
        };
        queueMicrotask(() => {
          request.onsuccess?.();
          queueMicrotask(() => tx.oncomplete?.());
        });
        return request;
      },
      put(value: unknown, key: string) {
        writes.push(key);
        values.set(key, structuredClone(value));
      },
      delete(key: string) {
        values.delete(key);
      },
    };
    const tx = { objectStore: () => store, oncomplete: undefined as (() => void) | undefined };
    const opened = vi.spyOn(collectionDb, 'openCollection').mockResolvedValue({
      transaction: () => tx,
      close() {},
    } as unknown as IDBDatabase);
    try {
      const deck = '01900000-0000-7000-8000-000000000011';
      const initial = newImportDraft('account-a', deck);
      initial.preparation.raw = 'one — first';
      const attempt = createAttempt(
        parseImport(initial.preparation.raw, 'text'),
        [],
        'skip',
        {},
        deck,
      );
      const first = await saveImportDraft({ ...initial, delivery: { attempt, done: 0 } });
      const { delivery: _delivery, ...preparationOnly } = first;
      const replaced = await saveImportDraft({
        ...preparationOnly,
        preparation: { ...first.preparation, raw: 'replacement' },
      });
      const restored = await saveImportDraft({
        ...replaced,
        preparation: first.preparation,
        delivery: first.delivery!,
      });
      expect(values.get(`import-preparation:${initial.id}`)).toEqual(first.preparation);
      expect(values.get(`import-attempt:${initial.id}`)).toEqual(attempt);
      const payloadWrites = writes.filter((key) =>
        /import-(preparation|attempt):/.test(key),
      ).length;
      await saveImportDraft({ ...restored, delivery: { attempt, done: 1 } });
      expect(writes.filter((key) => /import-(preparation|attempt):/.test(key))).toHaveLength(
        payloadWrites,
      );
      expect(values.get(`import-draft:${initial.id}`)).toMatchObject({ delivery: { done: 1 } });
    } finally {
      opened.mockRestore();
    }
  });
});
