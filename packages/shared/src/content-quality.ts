import { z } from 'zod';

import { idSchema } from './api/common.js';
import { noteSchema } from './api/notes.js';

/** Fixed vocabulary checks, not linguistic judgments or Note validation. */
export const CONTENT_CHECKS = [
  'translation-without-example',
  'example-without-translation',
  'missing-example',
  'missing-definition',
] as const;
export const contentCheckSchema = z.enum(CONTENT_CHECKS);
export type ContentCheck = z.infer<typeof contentCheckSchema>;

export const CONTENT_CHECK_KIND = {
  'translation-without-example': 'consistency',
  'example-without-translation': 'enrichment',
  'missing-example': 'enrichment',
  'missing-definition': 'enrichment',
} as const;

/** Search supported vocabulary text and saved metadata as literal substrings. */
export function contentQualitySearchText(
  fields: Record<string, unknown>,
  tags: readonly string[],
  source: string | null,
  deckPath: readonly string[],
): string {
  return [
    ...[
      'term',
      'translation',
      'reading',
      'definition',
      'example',
      'exampleTranslation',
      'mnemonic',
      'note',
    ].map((field) => (typeof fields[field] === 'string' ? fields[field] : undefined)),
    tags.join(' '),
    source,
    deckPath.join(' / '),
  ]
    .filter((value) => value !== undefined && value !== null)
    .join('\n')
    .toLowerCase();
}

/** Optional text has content only if it contains a non-whitespace character. */
export function contentChecks(noteType: string, fields: Record<string, unknown>): ContentCheck[] {
  if (noteType !== 'vocab') return [];
  const has = (field: string) =>
    typeof fields[field] === 'string' && fields[field].trim().length > 0;
  const example = has('example');
  const translation = has('exampleTranslation');
  return [
    ...(!example && translation ? (['translation-without-example'] as const) : []),
    ...(example && !translation ? (['example-without-translation'] as const) : []),
    ...(!example ? (['missing-example'] as const) : []),
    ...(!has('definition') ? (['missing-definition'] as const) : []),
  ];
}

export const contentQualityQuerySchema = z.strictObject({
  deckId: idSchema.optional(),
  category: contentCheckSchema.optional(),
  search: z.string().trim().min(1).max(100).optional(),
  cursor: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export const contentQualityCountsSchema = z.object({
  'translation-without-example': z.number().int().nonnegative(),
  'example-without-translation': z.number().int().nonnegative(),
  'missing-example': z.number().int().nonnegative(),
  'missing-definition': z.number().int().nonnegative(),
});
export const contentQualityNoteSchema = noteSchema.extend({
  deckPath: z.array(z.string()).min(1),
  pending: z.boolean().optional(),
});
export const contentQualityPageSchema = z.object({
  counts: contentQualityCountsSchema,
  vocabularyCount: z.number().int().nonnegative(),
  items: z.array(contentQualityNoteSchema),
  nextCursor: idSchema.optional(),
  local: z.literal(true).optional(),
});
export type ContentQualityQuery = z.infer<typeof contentQualityQuerySchema>;
export type ContentQualityCounts = z.infer<typeof contentQualityCountsSchema>;
export type ContentQualityNote = z.infer<typeof contentQualityNoteSchema>;
export type ContentQualityPage = z.infer<typeof contentQualityPageSchema>;
