import { describe, expect, it, vi } from 'vitest';

import { detectFormat, parseImport } from '@neuron/shared';

import { newImportDraft, validateImportDraft, importDraftVisit } from './import-drafts';
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
});
