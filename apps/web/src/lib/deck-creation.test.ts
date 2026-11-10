import { describe, expect, it } from 'vitest';

import { uuidV7 } from '@neuron/shared';
import type { DeckNode, SavedDeckCreation } from '@neuron/shared';

import { ApiFailure } from './api';
import { overlayDeckCreations, validateDeckCreations, versionSkew } from './deck-creation';

const accountId = 'device-owner';
const folder: DeckNode = {
  id: uuidV7(),
  kind: 'folder',
  name: 'Folder',
  parentId: null,
  path: [],
  position: 0,
  settings: { targetLanguage: 'de' },
  createdAt: '2026-10-31T00:00:00.000Z',
  updatedAt: '2026-10-31T00:00:00.000Z',
  rev: 3,
  children: [],
  due: 2,
  fresh: 4,
};
const entry = (): SavedDeckCreation => ({
  version: 1,
  accountId,
  createdAt: folder.createdAt,
  position: 0,
  state: 'pending',
  ancestors: [folder],
  payload: {
    accountId,
    operationId: uuidV7(),
    entityId: uuidV7(),
    kind: 'deck',
    name: 'Saved deck',
    parentId: folder.id,
    ancestors: [{ id: folder.id, rev: folder.rev }],
  },
});

describe('Library-only saved collection projection', () => {
  it('adds exactly one local row without mutating the authoritative hierarchy or learning counts', () => {
    const saved = entry();
    const tree = overlayDeckCreations([folder], [saved, saved], 3);
    expect(tree[0]?.children).toHaveLength(1);
    expect(tree[0]?.children[0]).toMatchObject({
      id: saved.payload.entityId,
      rev: 0,
      parentId: folder.id,
      path: [folder.id],
      settings: null,
      noteCount: 0,
      children: [],
    });
    expect(tree[0]).toMatchObject({ due: 2, fresh: 4 });
    expect(folder.children).toEqual([]);
  });
  it('does not silently relocate work when an ancestor moves, disappears or becomes a Deck', () => {
    const saved = entry();
    expect(overlayDeckCreations([], [saved], 3)).toEqual([]);
    expect(
      overlayDeckCreations([{ ...folder, parentId: uuidV7() }], [saved], 3)[0]?.children,
    ).toEqual([]);
    expect(overlayDeckCreations([{ ...folder, kind: 'deck' }], [saved], 3)[0]?.children).toEqual(
      [],
    );
  });
  it('holds an acknowledged creation until the pull reaches it, then never resurrects a missing row', () => {
    const saved = entry();
    saved.state = 'synchronized';
    saved.outcome = {
      operationId: saved.payload.operationId,
      entityId: saved.payload.entityId,
      status: 'applied',
      revision: 4,
    };
    expect(overlayDeckCreations([folder], [saved], 3)[0]?.children).toHaveLength(1);
    expect(overlayDeckCreations([folder], [saved], 4)[0]?.children).toEqual([]);
    saved.state = 'resolved';
    expect(overlayDeckCreations([folder], [saved], 3)[0]?.children).toEqual([]);
  });
  it('fails closed on another account, unknown formats and inconsistent identities or ancestry', () => {
    const saved = entry();
    expect(validateDeckCreations([saved], accountId)).toHaveLength(1);
    expect(() => validateDeckCreations([saved], 'another-account')).toThrow();
    expect(() => validateDeckCreations([{ ...saved, version: 2 }], accountId)).toThrow();
    expect(() => validateDeckCreations([{ ...saved, state: 'synchronized' }], accountId)).toThrow();
    expect(() =>
      validateDeckCreations(
        [{ ...saved, ancestors: [{ ...folder, parentId: uuidV7() }] }],
        accountId,
      ),
    ).toThrow();
    expect(() =>
      validateDeckCreations(
        [
          {
            ...saved,
            outcome: {
              operationId: uuidV7(),
              entityId: saved.payload.entityId,
              status: 'applied',
              revision: 5,
            },
          },
        ],
        accountId,
      ),
    ).toThrow();
  });
});

describe('a new deck saved on the device with its languages', () => {
  const withLanguages = (): SavedDeckCreation => {
    const saved = entry();
    return {
      ...saved,
      payload: { ...saved.payload, settings: { targetLanguage: 'fr', nativeLanguage: 'en' } },
    };
  };

  it('shows its own languages in Library, over what its folder says', () => {
    const tree = overlayDeckCreations([folder], [withLanguages()], 3);

    expect(tree[0]?.children[0]?.settings).toEqual({ targetLanguage: 'fr', nativeLanguage: 'en' });
  });

  it('reads records from before languages and records with them side by side', () => {
    expect(validateDeckCreations([entry(), withLanguages()], accountId)).toHaveLength(2);
    expect(() =>
      validateDeckCreations(
        [{ ...withLanguages(), payload: { ...withLanguages().payload, kind: 'folder' } }],
        accountId,
      ),
    ).toThrow();
  });

  it('waits for the api that understands languages instead of being marked refused', () => {
    const refused = (status: number, code: 'invalid_request' | 'not_found') =>
      new ApiFailure({ status, code, correlationId: 'test' });

    // The previous api refuses the field it does not know: wait and retry.
    expect(versionSkew(refused(400, 'invalid_request'), withLanguages())).toBe(true);
    // A creation without languages was never sent to an api that refuses them.
    expect(versionSkew(refused(400, 'invalid_request'), entry())).toBe(false);
    // Any other refusal keeps its meaning.
    expect(versionSkew(refused(404, 'not_found'), withLanguages())).toBe(false);
    expect(versionSkew(new Error('offline'), withLanguages())).toBe(false);
  });
});
