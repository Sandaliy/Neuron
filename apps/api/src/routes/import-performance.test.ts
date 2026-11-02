import { expect, it } from 'vitest';

import { IMPORT_CHUNK_SIZE, normaliseTerm, uuidV7 } from '@neuron/shared';

import { vocabularyFixture } from '../../../../scripts/import-fixture.js';
import { createDb } from '../db/client.js';
import { createRepositories } from '../db/repositories/index.js';
import { createUser, rawOwnerPool, testDatabase } from '../db/testing/database.js';
import { json, testServer } from '../testing/server.js';

const database = testDatabase();

it.skipIf(!database || process.env['IMPORT_BENCHMARK'] !== 'true')(
  'measures rich 5,000-Note imports against PostgreSQL',
  async () => {
    if (!database) return;
    if (process.env['IMPORT_BENCHMARK_STALE_STATS'] === 'true') {
      const owner = rawOwnerPool(database);
      try {
        await owner.query('analyze notes');
        await owner.query('analyze cards');
      } finally {
        await owner.end();
      }
    }
    const samples = [];
    for (let run = 0; run < 3; run++) {
      const user = `import-benchmark-${run}`;
      await createUser(database, user);
      let queries = 0;
      let summaryStarted = 0;
      const summaryQueries: { operation: string; atMs: number }[] = [];
      const client = createDb(database.appUrl, {
        logger: {
          logQuery(query) {
            queries++;
            if (summaryStarted)
              summaryQueries.push({
                operation: query.split(' ')[0]!,
                atMs: Math.round(performance.now() - summaryStarted),
              });
          },
        },
      });
      const repositories = createRepositories(client, user);
      const server = testServer(database, user, client);
      const deckId = (
        await repositories.decks.create({
          name: 'Import benchmark',
          settings: {
            ladder: [
              { direction: 'recognition', opensAtStability: 0 },
              { direction: 'recall', opensAtStability: 0 },
              { direction: 'listening', opensAtStability: 0 },
            ],
          },
        })
      ).id;
      const batchId = uuidV7();
      await json(
        await server.request('/api/imports', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            id: batchId,
            deckId,
            source: 'Rich frequency list',
            format: 'json',
          }),
        }),
        201,
      );
      const notes = vocabularyFixture(5000).map(({ tags, rank, ...fields }) => ({
        id: uuidV7(),
        noteType: 'vocab',
        fields,
        tags,
        rank,
      }));
      const beforeHeap = process.memoryUsage().heapUsed;
      let peakHeap = beforeHeap;
      queries = 0;
      const chunkMs: number[] = [];
      for (let at = 0; at < notes.length; at += IMPORT_CHUNK_SIZE) {
        const start = performance.now();
        const body = await json<{ notes: number; cards: number }>(
          await server.request(`/api/imports/${batchId}/notes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ notes: notes.slice(at, at + IMPORT_CHUNK_SIZE) }),
          }),
          200,
        );
        expect(body).toMatchObject({ notes: 500, cards: 1500 });
        chunkMs.push(performance.now() - start);
        peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
      }
      const applyQueries = queries;
      const duplicateAt = performance.now();
      queries = 0;
      let found = 0;
      for (let at = 0; at < notes.length; at += 1000)
        found += (
          await repositories.notes.duplicatesOf(
            deckId,
            notes.slice(at, at + 1000).map((note) => normaliseTerm(note.fields.term)),
          )
        ).length;
      expect(found).toBe(5000);
      const duplicateMs = performance.now() - duplicateAt;
      const duplicateQueries = queries;
      const reconcileAt = performance.now();
      summaryStarted = reconcileAt;
      const summary = await json<{ notes: number; cards: number }>(
        await server.request(`/api/imports/${batchId}`),
        200,
      );
      expect(summary).toMatchObject({ notes: 5000, cards: 15000 });
      const reconcileMs = performance.now() - reconcileAt;
      summaryStarted = 0;
      const pool = rawOwnerPool(database);
      try {
        const state = await pool.query(
          `select count(*) as notes, count(distinct rank) as ranks,
        count(*) filter (where fields->'grammar'->>'article' = 'das' and cardinality(tags) = 2) as rich
        from notes where import_batch_id = $1`,
          [batchId],
        );
        expect(state.rows[0]).toMatchObject({ notes: '5000', ranks: '5000', rich: '5000' });
      } finally {
        await pool.end();
      }
      samples.push({
        chunkMs: chunkMs.map((ms) => Math.round(ms)),
        applyMs: Math.round(chunkMs.reduce((a, b) => a + b, 0)),
        applyQueries,
        duplicateMs: Math.round(duplicateMs),
        duplicateQueries,
        reconcileMs: Math.round(reconcileMs),
        summaryQueries,
        sampledHeapGrowthMiB: Math.round((peakHeap - beforeHeap) / 1048576),
        rssMiB: Math.round(process.memoryUsage().rss / 1048576),
      });
      await client.$client.end();
    }
    console.log(
      JSON.stringify({
        dataset: '5000 rich vocabulary Notes, 15000 Cards, 5000 existing matches',
        samples,
      }),
    );
  },
  600_000,
);
