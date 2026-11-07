import { describe, expect, it } from 'vitest';

import {
  EXPORT_ENTITIES,
  EXPORT_FORMAT,
  EXPORT_VERSION,
  ExportValidator,
  emptyExportCounts,
  exportUtf8Length,
} from './account-export.js';

const exportId = '019a0000-0000-7000-8000-000000000001';
function example() {
  const lines = [
    {
      type: 'manifest',
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportId,
      accountId: 'learner',
      snapshotAt: '2026-11-01T10:00:00Z',
      revision: 9,
      entities: EXPORT_ENTITIES,
      guide: {},
    },
    { type: 'record', entity: 'preferences', data: { id: 'learner' } },
    {
      type: 'record',
      entity: 'notes',
      data: { id: 'note', fields: { front: 'Привет 👋', back: 'Hello' } },
    },
  ].map((row) => `${JSON.stringify(row)}\n`);
  const counts = { ...emptyExportCounts(), preferences: 1, notes: 1 };
  lines.push(
    `${JSON.stringify({ type: 'complete', exportId, records: 2, counts, bytes: lines.reduce((sum, line) => sum + exportUtf8Length(line), 0) })}\n`,
  );
  return lines;
}

describe('versioned export delivery integrity', () => {
  it('accepts a fully delivered UTF-8 archive with exact byte and entity totals', () => {
    const validator = new ExportValidator('learner');
    for (const line of example()) validator.line(line);
    expect(validator.finish()).toMatchObject({ accountId: 'learner', revision: 9 });
    expect(validator.records).toBe(2);
    expect(exportUtf8Length('aé中👋')).toBe(10);
  });
  it.each([0, 1, 2, 3])('refuses interruption after %s lines', (count) => {
    const validator = new ExportValidator('learner');
    example()
      .slice(0, count)
      .forEach((line) => validator.line(line));
    expect(() => validator.finish()).toThrow('export_incomplete');
  });
  it('refuses another account and future versions', () => {
    expect(() => new ExportValidator('stranger').line(example()[0]!)).toThrow('export_account');
    expect(() =>
      new ExportValidator('learner').line(example()[0]!.replace('"version":1', '"version":2')),
    ).toThrow();
  });
  it.each(['bytes', 'records', 'counts', 'exportId'])(
    'refuses corrupted completion %s',
    (field) => {
      const lines = example();
      const validator = new ExportValidator('learner');
      lines.slice(0, -1).forEach((line) => validator.line(line));
      const last = JSON.parse(lines.at(-1)!) as Record<string, unknown>;
      last[field] =
        field === 'counts'
          ? emptyExportCounts()
          : field === 'exportId'
            ? '019a0000-0000-7000-8000-000000000002'
            : 0;
      expect(() => validator.line(`${JSON.stringify(last)}\n`)).toThrow();
    },
  );
  it('refuses trailing data, missing final newline and a server failure', () => {
    const validator = new ExportValidator('learner');
    example().forEach((line) => validator.line(line));
    expect(() => validator.line('\n')).toThrow('export_invalid');
    expect(() => new ExportValidator('learner').line(example()[0]!.trimEnd())).toThrow();
    const failed = new ExportValidator('learner');
    failed.line(example()[0]!);
    expect(() => failed.line('{"type":"error","code":"export_limit"}\n')).toThrow('export_limit');
  });
});
