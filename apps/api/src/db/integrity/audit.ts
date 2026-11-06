import { performance } from 'node:perf_hooks';

import { drizzle } from 'drizzle-orm/neon-serverless';

import { verifyRuntimeDatabase } from '../compatibility.js';
import { schema, USER_OWNED_TABLES } from '../schema/index.js';

import { structuralChecks } from './checks.js';
import { verifyDeep } from './deep.js';

import type { IntegrityCheck } from './checks.js';
import type { Database } from '../client.js';
import type { Pool, PoolClient } from '@neondatabase/serverless';

export interface AuditOptions {
  userId: string;
  expectedDatabase?: string;
  details?: boolean;
  deep?: boolean;
  cardId?: string;
  deckId?: string;
  afterCard?: string;
  afterNote?: string;
  afterPractice?: string;
  afterReceipt?: string;
  pageSize?: number;
  maxItems?: number;
  maxEvents?: number;
  statementMs?: number;
  budgetMs?: number;
  signal?: AbortSignal;
}

export interface Finding {
  check: string;
  severity: IntegrityCheck['severity'];
  count: number;
  context: string;
  samples?: string[];
}

export interface AuditReport {
  version: 1;
  status: 'complete' | 'incomplete' | 'failed' | 'interrupted';
  mode: 'structural' | 'deep';
  snapshotAt?: string;
  revision?: string;
  findings: Finding[];
  checks: { id: string; count: number; elapsedMs: number }[];
  coverage: Record<string, { scanned: number; complete: boolean; after?: string }>;
  counts: Record<string, string>;
  metrics: { queries: number; maxRows: number; elapsedMs: number };
  failure?: { phase: string; code: string };
}

export class AuditStop extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

/** Bounds are enforced for programmatic callers as well as the CLI. */
export function auditLimits(options: AuditOptions) {
  const bounded = (value: number | undefined, fallback: number, min: number, max: number) => {
    const n = value ?? fallback;
    if (!Number.isInteger(n) || n < min || n > max) throw new AuditStop('arguments');
    return n;
  };
  if (!options.userId.trim() || options.userId.length > 200) throw new AuditStop('arguments');
  if (
    (options.cardId ||
      options.deckId ||
      options.afterCard ||
      options.afterNote ||
      options.afterPractice ||
      options.afterReceipt) &&
    !options.deep
  )
    throw new AuditStop('arguments');
  if (options.cardId && options.deckId) throw new AuditStop('arguments');
  for (const id of [
    options.cardId,
    options.deckId,
    options.afterCard,
    options.afterNote,
    options.afterPractice,
  ]) {
    if (id && !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id))
      throw new AuditStop('arguments');
  }
  if (options.afterReceipt && !safeReceiptCursor(options.afterReceipt))
    throw new AuditStop('arguments');
  return {
    pageSize: bounded(options.pageSize, 100, 1, 500),
    maxItems: bounded(options.maxItems, 1000, 1, 10_000),
    maxEvents: bounded(options.maxEvents, 2000, 1, 10_000),
    statementMs: bounded(options.statementMs, 5000, 1, 30_000),
    budgetMs: bounded(options.budgetMs, 60_000, 1, 600_000),
  };
}

export type AuditLimits = ReturnType<typeof auditLimits>;
export type AuditQuery = <T extends object>(sql: string, values?: unknown[]) => Promise<T[]>;

/** Current repository fingerprints contain a digest or a command UUID only. */
export function safeReceiptCursor(value: string): boolean {
  return (
    /^[a-f0-9]{64}$/.test(value) ||
    /^(rename|deck-create|note-create|note-edit|review-undo|practice):[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(
      value,
    )
  );
}

export function addFinding(
  report: AuditReport,
  details: boolean | undefined,
  check: string,
  severity: Finding['severity'],
  context: string,
  id?: string,
  count = 1,
): void {
  let finding = report.findings.find((entry) => entry.check === check);
  if (!finding) {
    finding = { check, severity, count: 0, context, ...(details ? { samples: [] } : {}) };
    report.findings.push(finding);
  }
  finding.count += count;
  if (id && finding.samples && finding.samples.length < 10 && !finding.samples.includes(id))
    finding.samples.push(id);
}

/** No connection fallback, owner mode, account discovery, migration or write path. */
export async function auditAccount(pool: Pool, options: AuditOptions): Promise<AuditReport> {
  const limits = auditLimits(options);
  const started = performance.now();
  const report: AuditReport = {
    version: 1,
    status: 'incomplete',
    mode: options.deep ? 'deep' : 'structural',
    findings: [],
    checks: [],
    coverage: {},
    counts: {},
    metrics: { queries: 0, maxRows: 0, elapsedMs: 0 },
  };
  let connection: PoolClient | undefined;
  let phase = 'connect';
  let transaction = false;
  const guard = () => {
    if (options.signal?.aborted) throw new AuditStop('interrupted');
    if (performance.now() - started >= limits.budgetMs) throw new AuditStop('budget');
  };
  try {
    guard();
    connection = await pool.connect();
    await connection.query('begin isolation level repeatable read read only');
    transaction = true;
    await connection.query(
      `select set_config('app.user_id',$1,true),
      set_config('statement_timeout',$2,true), set_config('lock_timeout','500',true),
      set_config('idle_in_transaction_session_timeout','10000',true),
      set_config('search_path','pg_catalog,public',true), set_config('work_mem','4MB',true),
      set_config('max_parallel_workers_per_gather','0',true), set_config('jit','off',true)`,
      [options.userId, String(limits.statementMs)],
    );
    phase = 'restricted-schema';
    // Reuse the release role/column manifest, inside the same read-only snapshot.
    // Compatibility only uses execute; the driver's PoolClient has the same
    // query surface but a narrower $client type than the runtime Pool wrapper.
    await verifyRuntimeDatabase(
      drizzle(connection, { schema }) as unknown as Database,
      'neuron_app',
    );
    const query: AuditQuery = async (sql, values = []) => {
      guard();
      const remaining = Math.max(1, Math.floor(limits.budgetMs - (performance.now() - started)));
      await connection!.query("select set_config('statement_timeout',$1,true)", [
        String(Math.min(limits.statementMs, remaining)),
      ]);
      const result = await connection!.query(sql, values);
      report.metrics.queries += 1;
      report.metrics.maxRows = Math.max(report.metrics.maxRows, result.rows.length);
      guard();
      return result.rows;
    };
    const policies = await query<{ name: string; active: boolean; forced: boolean }>(
      `select c.relname as name, row_security_active(c.oid) as active, c.relforcerowsecurity as forced
       from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='public' and c.relname=any($1::text[])`,
      [[...USER_OWNED_TABLES, 'note_types']],
    );
    if (
      policies.length !== USER_OWNED_TABLES.length + 1 ||
      policies.some((row) => !row.active || !row.forced)
    )
      throw new AuditStop('rls');
    phase = 'account';
    const [account] = await query<{ revision: string; snapshot: Date; database: string }>(
      'select current_rev::text as revision, transaction_timestamp() as snapshot, current_database() as database from "user" where id=$1',
      [options.userId],
    );
    if (!account) throw new AuditStop('account-unavailable');
    if (options.expectedDatabase && options.expectedDatabase !== account.database)
      throw new AuditStop('target');
    report.snapshotAt = account.snapshot.toISOString();
    report.revision = account.revision;
    if (BigInt(account.revision) > BigInt(Number.MAX_SAFE_INTEGER)) {
      addFinding(
        report,
        options.details,
        'account-revision',
        'error',
        'Account head exceeds the exact protocol number range.',
      );
    }
    for (const table of USER_OWNED_TABLES) {
      phase = `count:${table}`;
      const [count] = await query<{ count: string }>(
        `select count(*)::text as count from ${table} where user_id=$1`,
        [options.userId],
      );
      report.counts[table] = count?.count ?? '0';
    }
    for (const check of structuralChecks) {
      phase = check.id;
      const before = performance.now();
      const [result] = await query<{ count: string }>(
        `select count(*)::text as count from (${check.sql}) violations`,
        [options.userId],
      );
      const count = Number(result?.count ?? 0);
      if (!Number.isSafeInteger(count)) throw new AuditStop('count-range');
      if (count) {
        addFinding(
          report,
          options.details,
          check.id,
          check.severity,
          check.context,
          undefined,
          count,
        );
        if (options.details) {
          const samples = await query<{ id: string | null }>(
            `select id::text from (${check.sql}) violations where id is not null order by id limit 10`,
            [options.userId],
          );
          report.findings.find((entry) => entry.check === check.id)!.samples = samples.flatMap(
            (row) => (row.id ? [row.id] : []),
          );
        }
      }
      report.checks.push({
        id: check.id,
        count,
        elapsedMs: Math.round(performance.now() - before),
      });
    }
    report.coverage['structural'] = { scanned: structuralChecks.length, complete: true };
    if (options.deep) {
      phase = 'deep';
      await verifyDeep(query, options, limits, report);
    }
    report.status = Object.values(report.coverage).every((scope) => scope.complete)
      ? 'complete'
      : 'incomplete';
  } catch (error) {
    const code = error instanceof AuditStop ? error.reason : sqlState(error);
    report.status =
      code === 'interrupted' ? 'interrupted' : code === 'budget' ? 'incomplete' : 'failed';
    report.failure = { phase, code };
  } finally {
    if (connection) {
      try {
        if (transaction) await connection.query('rollback');
        connection.release();
      } catch {
        connection.release(true);
        report.status = 'failed';
        report.failure = { phase: 'rollback', code: 'connection' };
      }
    }
    report.metrics.elapsedMs = Math.round(performance.now() - started);
  }
  return report;
}

/** SQL messages/detail/stack can contain private values or connection URLs. */
function sqlState(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : 'database-or-schema';
}

export function auditExitCode(report: AuditReport): number {
  if (report.status === 'interrupted') return 130;
  if (report.status !== 'complete') return 2;
  return report.findings.some((finding) => finding.severity === 'error') ? 1 : 0;
}
