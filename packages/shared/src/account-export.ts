import { z } from 'zod';

/** Version 1 is UTF-8 JSON Lines, with a manifest first and completion last. */
export const EXPORT_FORMAT = 'neuron-account-export' as const;
export const EXPORT_VERSION = 1 as const;
export const EXPORT_MAX_BYTES = 128 * 1024 * 1024;
export const EXPORT_MAX_LINE_BYTES = 4 * 1024 * 1024;
export const EXPORT_ENTITIES = [
  'preferences',
  'noteTypes',
  'decks',
  'importBatches',
  'notes',
  'cards',
  'reviews',
  'learningRestarts',
  'studyPresets',
  'practiceRuns',
  'conflicts',
] as const;
export const exportEntitySchema = z.enum(EXPORT_ENTITIES);
export type ExportEntity = z.infer<typeof exportEntitySchema>;

export const exportRequestSchema = z.strictObject({ accountId: z.string().min(1).max(200) });
export const exportManifestSchema = z.object({
  type: z.literal('manifest'),
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(EXPORT_VERSION),
  exportId: z.uuid(),
  accountId: z.string(),
  snapshotAt: z.iso.datetime({ offset: true }),
  revision: z.number().int().nonnegative(),
  entities: z.array(exportEntitySchema),
  guide: z.record(z.string(), z.unknown()),
});
export type ExportManifest = z.infer<typeof exportManifestSchema>;
export const exportRecordSchema = z.object({
  type: z.literal('record'),
  entity: exportEntitySchema,
  data: z.record(z.string(), z.unknown()),
});
export const exportCompleteSchema = z.object({
  type: z.literal('complete'),
  exportId: z.uuid(),
  records: z.number().int().nonnegative(),
  counts: z.record(exportEntitySchema, z.number().int().nonnegative()),
  /** UTF-8 bytes before this completion line. */
  bytes: z.number().int().nonnegative(),
});

export function emptyExportCounts(): Record<ExportEntity, number> {
  return Object.fromEntries(EXPORT_ENTITIES.map((entity) => [entity, 0])) as Record<
    ExportEntity,
    number
  >;
}

/** Portable UTF-8 length, without browser or Node globals. */
export function exportUtf8Length(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}

/** Streaming integrity check; retains counts and one line, never collection contents. */
export class ExportValidator {
  manifest: ExportManifest | undefined;
  complete = false;
  records = 0;
  bytes = 0;
  private counts = emptyExportCounts();
  constructor(private accountId: string) {}

  line(line: string): void {
    const bytes = exportUtf8Length(line);
    if (
      this.complete ||
      !line.endsWith('\n') ||
      bytes > EXPORT_MAX_LINE_BYTES ||
      this.bytes + bytes > EXPORT_MAX_BYTES
    )
      throw new Error('export_invalid');
    const value: unknown = JSON.parse(line);
    if (!this.manifest) {
      this.manifest = exportManifestSchema.parse(value);
      if (
        this.manifest.accountId !== this.accountId ||
        this.manifest.entities.join(',') !== EXPORT_ENTITIES.join(',')
      )
        throw new Error('export_account');
    } else if (
      typeof value === 'object' &&
      value !== null &&
      'type' in value &&
      value.type === 'complete'
    ) {
      const end = exportCompleteSchema.parse(value);
      if (
        end.exportId !== this.manifest.exportId ||
        end.records !== this.records ||
        end.bytes !== this.bytes ||
        EXPORT_ENTITIES.some((entity) => end.counts[entity] !== this.counts[entity]) ||
        this.counts.preferences !== 1
      )
        throw new Error('export_invalid');
      this.complete = true;
    } else {
      if (
        typeof value === 'object' &&
        value !== null &&
        'code' in value &&
        value.code === 'export_limit'
      )
        throw new Error('export_limit');
      const row = exportRecordSchema.parse(value);
      this.counts[row.entity]++;
      this.records++;
    }
    this.bytes += bytes;
  }

  finish(): ExportManifest {
    if (!this.complete || !this.manifest) throw new Error('export_incomplete');
    return this.manifest;
  }
}
