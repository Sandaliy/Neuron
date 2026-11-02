import { expect, it, vi } from 'vitest';

import { parseImport, rowProblems, termCounts } from '@neuron/shared';
import type { ImportFormat } from '@neuron/shared';

import { vocabularyFixture } from '../../../../../scripts/import-fixture';

import { newImportDraft, validateImportDraft } from './import-drafts';
import { createAttempt, planRows } from './import-plan';

vi.mock('../../lib/offline', () => ({ offlineState: () => ({}), accountEpoch: () => 0 }));

it.skipIf(process.env['IMPORT_BENCHMARK'] !== 'true')(
  'measures matched large Import preparation stages',
  () => {
    const rows = vocabularyFixture(5000);
    const formats: [ImportFormat, string][] = [
      ['json', JSON.stringify({ noteType: 'vocab', notes: rows })],
      [
        'csv',
        [
          'term,translation,example',
          ...rows.map((r) => `${r.term},${r.translation},${r.example}`),
        ].join('\n'),
      ],
      ['tsv', rows.map((r) => `${r.term}\t${r.translation}\t${r.example}`).join('\n')],
      [
        'anki',
        '#separator:tab\n#html:true\n' + rows.map((r) => `${r.term}\t${r.translation}`).join('\n'),
      ],
      ['text', rows.map((r) => `${r.term} — ${r.translation}`).join('\n')],
    ];
    const timings: Record<string, number> = {};
    function measure(label: string, work: () => void) {
      work();
      const samples = Array.from({ length: 7 }, () => {
        const start = performance.now();
        work();
        return performance.now() - start;
      }).sort((a, b) => a - b);
      timings[label] = Math.round(samples[3]! * 100) / 100;
    }
    for (const [format, raw] of formats)
      measure(`parse.${format}`, () => {
        expect(parseImport(raw, format).rows).toHaveLength(5000);
      });
    const parsed = parseImport(formats[0]![1], 'json');
    const counts = termCounts(parsed.rows);
    measure('diagnostics', () => {
      parsed.rows.forEach((row) => rowProblems(row, parsed.noteType, counts));
    });
    measure('plan', () => {
      planRows(parsed, [], 'skip');
    });
    const deck = '01900000-0000-7000-8000-000000000011';
    const draft = {
      ...newImportDraft('bench', deck),
      revision: 1,
      delivery: { attempt: createAttempt(parsed, [], 'skip', {}, deck), done: 0 },
    };
    draft.preparation.raw = formats[0]![1];
    measure('validateCheckpoint', () => {
      validateImportDraft(draft, 'bench');
    });
    measure('cloneCheckpoint', () => {
      structuredClone(draft);
    });
    console.log(
      JSON.stringify({
        dataset: '5000 rich vocabulary Notes',
        runs: 7,
        milliseconds: timings,
        checkpointBytes: JSON.stringify(draft).length,
      }),
    );
  },
);
