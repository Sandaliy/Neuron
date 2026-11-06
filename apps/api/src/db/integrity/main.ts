import { resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { neonConfig, Pool } from '@neondatabase/serverless';

import { databaseFromUrl } from '../release/journal-verification.js';
import { requireUrl } from '../tooling.js';

import { auditAccount, auditExitCode, auditLimits } from './audit.js';

import type { AuditOptions } from './audit.js';

export const usage = `Database Integrity Doctor (read-only, one explicit account)
pnpm --filter @neuron/api exec tsx src/db/integrity/main.ts --user <id> --database <name> [options]
Connection: INTEGRITY_DATABASE_URL (restricted neuron_app role; no fallback).
Optional local WebSocket proxy: INTEGRITY_WS_PROXY.
Options:
  --details                 Up to ten affected UUIDs per finding and pagination cursors
  --deep                    Validate content, receipts, Practice and bounded Card replay
  --card <uuid>             Deep verification of one Card and its Note
  --deck <uuid>             Deep verification within one exact leaf Deck
  --after-card <uuid>       Continue deep Card pagination (new snapshot)
  --after-note <uuid>       Continue deep Note pagination (new snapshot)
  --after-practice <uuid>   Continue Practice pagination (new snapshot)
  --after-receipt <cursor>  Continue receipt pagination (new snapshot)
  --page-size <1..500>      Default 100
  --max-items <1..10000>    Per deep phase, default 1000
  --max-events <1..10000>   Per Card current-life event cap, default 2000
  --statement-ms <1..30000> Default 5000
  --budget-ms <1..600000>   Default 60000 per account snapshot
Exit: 0 complete/no confirmed violations (warnings still require assessment),
      1 confirmed violations, 2 failed/incomplete, 130 interrupted.
Structural checks always cover the account; --card/--deck narrow deep phases only.`;

export function parseArguments(args: readonly string[]): {
  options: AuditOptions;
  database: string;
} {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const names = new Set([
    'user',
    'database',
    'card',
    'deck',
    'after-card',
    'after-note',
    'after-practice',
    'after-receipt',
    'page-size',
    'max-items',
    'max-events',
    'statement-ms',
    'budget-ms',
  ]);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? '';
    const key = arg.slice(2);
    if (arg === '--details' || arg === '--deep') {
      if (flags.has(key)) throw new Error('arguments');
      flags.add(key);
    } else {
      const value = args[++index];
      if (
        !arg.startsWith('--') ||
        !names.has(key) ||
        values.has(key) ||
        !value ||
        value.startsWith('--')
      )
        throw new Error('arguments');
      values.set(key, value);
    }
  }
  const userId = values.get('user');
  const database = values.get('database');
  if (!userId || !database || database.length > 63) throw new Error('arguments');
  const options: AuditOptions = { userId, details: flags.has('details'), deep: flags.has('deep') };
  for (const [key, property] of [
    ['card', 'cardId'],
    ['deck', 'deckId'],
    ['after-card', 'afterCard'],
    ['after-note', 'afterNote'],
    ['after-practice', 'afterPractice'],
    ['after-receipt', 'afterReceipt'],
  ] as const) {
    const value = values.get(key);
    if (value) options[property] = value;
  }
  for (const [key, property] of [
    ['page-size', 'pageSize'],
    ['max-items', 'maxItems'],
    ['max-events', 'maxEvents'],
    ['statement-ms', 'statementMs'],
    ['budget-ms', 'budgetMs'],
  ] as const) {
    const value = values.get(key);
    if (value !== undefined) {
      if (!/^\d+$/.test(value)) throw new Error('arguments');
      options[property] = Number(value);
    }
  }
  auditLimits(options);
  return { options, database };
}

async function main() {
  if (process.argv.slice(2).length === 1 && process.argv[2] === '--help') {
    console.log(usage);
    return;
  }
  const { options, database } = parseArguments(process.argv.slice(2));
  const url = requireUrl(
    'INTEGRITY_DATABASE_URL',
    'Choose an explicit restricted assessment connection.',
  );
  if (databaseFromUrl(url) !== database) throw new Error('target');
  const proxy = process.env['INTEGRITY_WS_PROXY'];
  if (proxy) {
    neonConfig.wsProxy = proxy;
    neonConfig.useSecureWebSocket = false;
    neonConfig.pipelineConnect = false;
  }
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  const pool = new Pool({
    connectionString: url,
    max: 1,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 1000,
  });
  pool.on('error', interrupt);
  try {
    const report = await auditAccount(pool, {
      ...options,
      expectedDatabase: database,
      signal: controller.signal,
    });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = auditExitCode(report);
  } finally {
    await pool.end();
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error(
      'Integrity audit could not start. Check arguments, explicit target and restricted connection. Use --help.',
    );
    process.exitCode = 2;
  });
}
