import { describe, expect, it } from 'vitest';

import { DEFAULT_BUDGET } from '@neuron/core';

import {
  DEFAULT_DECK_SETTINGS,
  deckLanguagesSchema,
  deckSettingsSchema,
  hasBothLanguagesOrNeither,
  missingDeckLanguages,
  resolveDeckSettings,
} from './deck-settings.js';

describe('deckSettingsSchema', () => {
  it('accepts an empty object, which is a deck that inherits everything', () => {
    expect(deckSettingsSchema.parse({})).toEqual({});
  });

  it('accepts a budget of seven days', () => {
    const budgetMinutes = [30, 20, 20, 20, 20, 20, 45];

    expect(deckSettingsSchema.parse({ budgetMinutes })).toEqual({ budgetMinutes });
  });

  it('rejects a budget of six days', () => {
    expect(deckSettingsSchema.safeParse({ budgetMinutes: [15, 15, 15, 15, 15, 15] }).success).toBe(
      false,
    );
  });

  it('rejects a retention target outside what the scheduler supports', () => {
    expect(deckSettingsSchema.safeParse({ targetRetention: 0.99 }).success).toBe(false);
    expect(deckSettingsSchema.safeParse({ targetRetention: 0.5 }).success).toBe(false);
  });

  it('rejects a direction that does not exist', () => {
    const result = deckSettingsSchema.safeParse({
      ladder: [{ direction: 'telepathy', opensAtStability: 0 }],
    });

    expect(result.success).toBe(false);
  });

  it('rejects an unknown setting rather than storing it silently', () => {
    expect(deckSettingsSchema.safeParse({ budgetMinutes: undefined, colour: 'red' }).success).toBe(
      false,
    );
  });
});

describe('the default budget', () => {
  it('matches the one the scheduler already uses', () => {
    // Two orderings of the same seven numbers would be a bug that only shows up
    // on one day of the week, so the database default and the scheduler default
    // are checked against each other rather than trusted.
    expect(DEFAULT_DECK_SETTINGS.budgetMinutes).toEqual(DEFAULT_BUDGET.minutesByWeekday);
  });

  it('is indexed from Sunday', () => {
    const [sunday, monday, , , , , saturday] = DEFAULT_DECK_SETTINGS.budgetMinutes;

    expect(sunday).toBe(30);
    expect(monday).toBe(15);
    expect(saturday).toBe(30);
  });
});

describe('resolveDeckSettings', () => {
  it('falls back to the defaults for a chain that says nothing', () => {
    expect(resolveDeckSettings([null, null])).toEqual(DEFAULT_DECK_SETTINGS);
  });

  it('takes the value from the nearest deck that has one', () => {
    const resolved = resolveDeckSettings([
      { maximumNewCardsPerDay: 40 },
      null,
      { maximumNewCardsPerDay: 5 },
    ]);

    expect(resolved.maximumNewCardsPerDay).toBe(5);
  });

  it('inherits a setting the leaf does not mention', () => {
    const resolved = resolveDeckSettings([
      { budgetMinutes: [10, 10, 10, 10, 10, 10, 10], targetRetention: 0.95 },
      { maximumNewCardsPerDay: 5 },
    ]);

    expect(resolved.budgetMinutes).toEqual([10, 10, 10, 10, 10, 10, 10]);
    expect(resolved.targetRetention).toBe(0.95);
    expect(resolved.maximumNewCardsPerDay).toBe(5);
  });

  it('does not let an absent key on a child wipe out the parent', () => {
    const resolved = resolveDeckSettings([
      { targetRetention: 0.95 },
      { targetRetention: undefined },
    ]);

    expect(resolved.targetRetention).toBe(0.95);
  });

  it('leaves the defaults untouched between calls', () => {
    resolveDeckSettings([{ maximumNewCardsPerDay: 1 }]);

    expect(DEFAULT_DECK_SETTINGS.maximumNewCardsPerDay).toBe(30);
  });

  it('keeps the ladder in the order it was given', () => {
    const ladder = [
      { direction: 'recognition' as const, opensAtStability: 0 },
      { direction: 'production' as const, opensAtStability: 30 },
    ];

    expect(resolveDeckSettings([{ ladder }]).ladder).toEqual(ladder);
  });
});

describe('deck languages', () => {
  it('needs both languages for a new deck', () => {
    expect(deckLanguagesSchema.parse({ targetLanguage: 'de', nativeLanguage: 'ru' })).toEqual({
      targetLanguage: 'de',
      nativeLanguage: 'ru',
    });
    expect(deckLanguagesSchema.safeParse({ targetLanguage: 'de' }).success).toBe(false);
    expect(deckLanguagesSchema.safeParse({ nativeLanguage: 'ru' }).success).toBe(false);
    expect(deckLanguagesSchema.safeParse({}).success).toBe(false);
  });

  it('allows the same language on both sides, for words explained in their own language', () => {
    expect(
      deckLanguagesSchema.safeParse({ targetLanguage: 'de', nativeLanguage: 'de' }).success,
    ).toBe(true);
  });

  it('refuses a language it has no name for, and anything that is not a language', () => {
    expect(
      deckLanguagesSchema.safeParse({ targetLanguage: 'xx', nativeLanguage: 'ru' }).success,
    ).toBe(false);
    expect(
      deckLanguagesSchema.safeParse({ targetLanguage: 'de', nativeLanguage: 'ru', level: 'A1' })
        .success,
    ).toBe(false);
  });

  it('names what a deck still lacks once its folders have been asked', () => {
    expect(missingDeckLanguages(resolveDeckSettings([]))).toEqual([
      'targetLanguage',
      'nativeLanguage',
    ]);
    expect(missingDeckLanguages(resolveDeckSettings([{ targetLanguage: 'de' }, {}]))).toEqual([
      'nativeLanguage',
    ]);
    expect(
      missingDeckLanguages(
        resolveDeckSettings([{ targetLanguage: 'de' }, null, { nativeLanguage: 'ru' }]),
      ),
    ).toEqual([]);
  });

  it('lets a deck keep its own languages over the folder it sits in', () => {
    const resolved = resolveDeckSettings([
      { targetLanguage: 'de', nativeLanguage: 'ru' },
      { targetLanguage: 'fr', nativeLanguage: 'en' },
    ]);

    expect(resolved.targetLanguage).toBe('fr');
    expect(resolved.nativeLanguage).toBe('en');
  });

  it('tells both or neither apart from one alone', () => {
    expect(hasBothLanguagesOrNeither(undefined)).toBe(true);
    expect(hasBothLanguagesOrNeither(null)).toBe(true);
    expect(hasBothLanguagesOrNeither({})).toBe(true);
    expect(hasBothLanguagesOrNeither({ targetLanguage: 'de', nativeLanguage: 'ru' })).toBe(true);
    expect(hasBothLanguagesOrNeither({ targetLanguage: 'de' })).toBe(false);
    expect(hasBothLanguagesOrNeither({ nativeLanguage: 'ru' })).toBe(false);
  });
});
