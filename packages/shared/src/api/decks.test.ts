import { describe, expect, it } from 'vitest';

import { uuidV7 } from '../uuid.js';

import { createOfflineDeckCommandSchema, savedDeckCreationSchema } from './deck-creation.js';
import { createDeckSchema } from './decks.js';

describe('creating a deck online', () => {
  const base = { id: uuidV7(), name: 'Lesson 1', parentId: null };

  it('takes a deck with both languages', () => {
    const settings = { targetLanguage: 'de', nativeLanguage: 'ru' } as const;

    expect(createDeckSchema.parse({ ...base, settings })).toMatchObject({ kind: 'deck', settings });
  });

  it('still takes a deck with no language at all, which is what an older app sends', () => {
    expect(createDeckSchema.safeParse(base).success).toBe(true);
    expect(createDeckSchema.safeParse({ ...base, settings: null }).success).toBe(true);
    expect(createDeckSchema.safeParse({ ...base, settings: { level: 'A1' } }).success).toBe(true);
  });

  it('refuses a deck with one language and not the other', () => {
    for (const settings of [{ targetLanguage: 'de' }, { nativeLanguage: 'ru', level: 'B1' }]) {
      const result = createDeckSchema.safeParse({ ...base, settings });

      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(['settings']);
    }
  });

  it('leaves folder defaults alone: a folder may carry one language', () => {
    expect(
      createDeckSchema.safeParse({ ...base, kind: 'folder', settings: { targetLanguage: 'de' } })
        .success,
    ).toBe(true);
  });
});

describe('creating a deck offline', () => {
  const command = {
    accountId: 'account',
    operationId: uuidV7(),
    entityId: uuidV7(),
    kind: 'deck' as const,
    name: 'Lesson 1',
    parentId: null,
    ancestors: [],
  };

  it('carries a new deck with both languages', () => {
    const settings = { targetLanguage: 'de', nativeLanguage: 'ru' } as const;

    expect(createOfflineDeckCommandSchema.parse({ ...command, settings }).settings).toEqual(
      settings,
    );
  });

  it('still reads a command saved by an older app, which has no languages', () => {
    expect(createOfflineDeckCommandSchema.parse(command)).toEqual(command);
  });

  it('refuses one language alone, and any language on a folder', () => {
    expect(
      createOfflineDeckCommandSchema.safeParse({ ...command, settings: { targetLanguage: 'de' } })
        .success,
    ).toBe(false);
    expect(
      createOfflineDeckCommandSchema.safeParse({
        ...command,
        kind: 'folder',
        settings: { targetLanguage: 'de', nativeLanguage: 'ru' },
      }).success,
    ).toBe(false);
    expect(
      createOfflineDeckCommandSchema.safeParse({
        ...command,
        settings: { targetLanguage: 'de', nativeLanguage: 'ru', level: 'A1' },
      }).success,
    ).toBe(false);
  });

  it('reads a device record from before languages, unchanged', () => {
    const record = {
      version: 1,
      accountId: 'account',
      payload: command,
      ancestors: [],
      createdAt: '2026-11-01T10:00:00.000Z',
      position: 0,
      state: 'pending',
    };

    expect(savedDeckCreationSchema.parse(record)).toEqual(record);
  });
});
