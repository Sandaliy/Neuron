import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createUser,
  rawAppPool,
  rawOwnerPool,
  repositoriesFor,
  testDatabase,
} from '../testing/database.js';

import { auditAccount } from './audit.js';

import type { Pool, PoolClient } from '@neondatabase/serverless';

const database = testDatabase();

/** Observe real protocol calls, without replacing database results or RLS. */
function intercept(pool: Pool, hook: (sql: string, client: PoolClient) => Promise<void>): Pool {
  return new Proxy(pool, {
    get(target, key) {
      if (key !== 'connect') return Reflect.get(target, key, target);
      return async () => {
        const client = await target.connect();
        return new Proxy(client, {
          get(inner, property) {
            if (property !== 'query') {
              const value = Reflect.get(inner, property, inner) as unknown;
              return typeof value === 'function' ? value.bind(inner) : value;
            }
            return async (...args: unknown[]) => {
              const sql =
                typeof args[0] === 'string'
                  ? args[0]
                  : String((args[0] as { text?: string })?.text);
              await hook(sql, client);
              return Reflect.apply(inner.query, inner, args);
            };
          },
        });
      };
    },
  });
}

describe.skipIf(!database)('Doctor operational safety on real PostgreSQL', () => {
  let app: Pool;
  let owner: Pool;
  let userId: string;
  beforeAll(async () => {
    app = rawAppPool(database!);
    owner = rawOwnerPool(database!);
    userId = `doctor-safety-${randomUUID()}`;
    await createUser(database!, userId);
    await repositoriesFor(database!, userId).decks.create({ name: 'Safety' });
  });
  afterAll(async () => {
    await app?.end();
    await owner?.end();
  });
  it('enforces READ ONLY in PostgreSQL, rolls back and clears account context on reuse', async () => {
    let proven = false;
    const observed = intercept(app, async (sql, client) => {
      if (proven || !sql.startsWith('select set_config')) return;
      proven = true;
      expect(
        (await client.query('show transaction_read_only')).rows[0]?.transaction_read_only,
      ).toBe('on');
      expect(
        (await client.query('show transaction_isolation')).rows[0]?.transaction_isolation,
      ).toBe('repeatable read');
      await client.query('savepoint readonly_probe');
      await expect(
        client.query('update "user" set current_rev=current_rev+1 where id=$1', [userId]),
      ).rejects.toMatchObject({ code: '25006' });
      await client.query('rollback to savepoint readonly_probe');
    });
    const before = (await owner.query('select current_rev from "user" where id=$1', [userId])).rows;
    expect((await auditAccount(observed, { userId })).status).toBe('complete');
    expect(proven).toBe(true);
    expect(
      (await owner.query('select current_rev from "user" where id=$1', [userId])).rows,
    ).toEqual(before);
    const client = await app.connect();
    try {
      expect(
        (await client.query("select current_setting('app.user_id',true) as id")).rows[0]?.id ?? '',
      ).toBe('');
      expect((await client.query('select id from decks')).rows).toEqual([]);
    } finally {
      client.release();
    }
  });
  it('contains server statement timeouts, suppresses SQL error detail, and releases the transaction', async () => {
    let delayed = false;
    const observed = intercept(app, async (sql, client) => {
      if (!delayed && sql.startsWith('select count(*)')) {
        delayed = true;
        await client.query('select pg_sleep(0.1)');
      }
    });
    const result = await auditAccount(observed, { userId, statementMs: 20 });
    expect(result.status).toBe('failed');
    expect(result.failure?.code).toBe('57014');
    expect(delayed).toBe(true);
    expect(JSON.stringify(result)).not.toContain('pg_sleep');
    expect((await auditAccount(app, { userId })).status).toBe('complete');
  });
  it('stops an in-flight run after signal without leaking the transaction or claiming completion', async () => {
    const controller = new AbortController();
    const observed = intercept(app, async (sql) => {
      if (sql.startsWith('select count(*)')) controller.abort();
    });
    const result = await auditAccount(observed, { userId, signal: controller.signal });
    expect(result.status).toBe('interrupted');
    expect(result.coverage['structural']).toBeUndefined();
    expect((await auditAccount(app, { userId })).status).toBe('complete');
  });
  it('rejects an unexpected connected database within its read-only snapshot', async () => {
    const result = await auditAccount(app, { userId, expectedDatabase: 'not_the_target' });
    expect(result.status).toBe('failed');
    expect(result.failure?.code).toBe('target');
  });
  it('observes one consistent snapshot while another connection commits', async () => {
    let changed = false;
    const observed = intercept(app, async (sql) => {
      if (!changed && sql.startsWith('select count(*)')) {
        changed = true;
        await owner.query('update decks set rev=rev+100 where user_id=$1', [userId]);
      }
    });
    try {
      const result = await auditAccount(observed, { userId });
      expect(result.status).toBe('complete');
      expect(result.findings).toEqual([]);
      expect(changed).toBe(true);
      expect(
        (await auditAccount(app, { userId })).findings.some((x) => x.check === 'decks-revision'),
      ).toBe(true);
    } finally {
      await owner.query('update decks set rev=rev-100 where user_id=$1', [userId]);
    }
  });
});
