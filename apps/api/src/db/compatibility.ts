import { getTableColumns, getTableName, sql } from 'drizzle-orm';

import {
  AUTH_TABLES,
  noteTypes,
  schema,
  user,
  USER_COLUMNS_FOR_APP,
  USER_OWNED_TABLES,
} from './schema/index.js';

import type { AuthDatabase, Database } from './client.js';
import type { AnyPgTable } from 'drizzle-orm/pg-core';

/** The two restricted connections deployed with the API. */
export type RuntimeDatabaseRole = 'neuron_app' | 'neuron_auth';

interface ExpectedTable {
  readonly name: string;
  readonly columns: readonly string[];
}

export interface RuntimeCompatibility {
  readonly role: RuntimeDatabaseRole;
  readonly database: string;
  readonly tables: number;
  readonly columns: number;
}

/** A release whose schema cannot satisfy the code that is checking it. */
export class SchemaCompatibilityError extends Error {
  override readonly name = 'SchemaCompatibilityError';

  constructor(readonly problems: readonly string[]) {
    super(`The database schema is incompatible with this release: ${problems.join(', ')}`);
  }
}

const allColumns = (table: AnyPgTable): readonly string[] =>
  Object.values(getTableColumns(table)).map((column) => column.name);

const expected = (table: AnyPgTable, columns = allColumns(table)): ExpectedTable => ({
  name: getTableName(table),
  columns,
});

const tablesByName = new Map<string, AnyPgTable>(
  Object.values(schema).map((table) => [getTableName(table), table] as const),
);

function tableNamed(name: string): AnyPgTable {
  const table = tablesByName.get(name);

  if (!table) {
    throw new Error(`The schema manifest names an unknown table: ${name}`);
  }

  return table;
}

/**
 * What each deployed credential must be able to name.
 *
 * This is derived from the same Drizzle tables the repositories and Better Auth
 * compile against. A newly added column therefore becomes required without a
 * second handwritten version number to remember. The application sees only the
 * intentionally public columns of `user`; authentication sees its own tables.
 */
const EXPECTED_SCHEMA: Record<RuntimeDatabaseRole, readonly ExpectedTable[]> = {
  neuron_app: [
    expected(user, USER_COLUMNS_FOR_APP),
    expected(noteTypes),
    ...USER_OWNED_TABLES.map((name) => expected(tableNamed(name))),
  ],
  neuron_auth: AUTH_TABLES.map((name) => expected(tableNamed(name))),
};

type CompatibilityDatabase = Database | AuthDatabase;

/**
 * Proves that one deployed connection is restricted and can see every table
 * and column its current code requires.
 */
export async function verifyRuntimeDatabase(
  db: CompatibilityDatabase,
  requiredRole: RuntimeDatabaseRole,
): Promise<RuntimeCompatibility> {
  const identity = await db.execute<{
    current_user: string;
    current_database: string;
    rolbypassrls: boolean;
    rolcreatedb: boolean;
    rolcreaterole: boolean;
    rolsuper: boolean;
  }>(sql`
    select current_user,
           current_database(),
           rolbypassrls,
           rolcreatedb,
           rolcreaterole,
           rolsuper
      from pg_roles
     where rolname = current_user
  `);
  const role = identity.rows[0];

  if (!role) {
    throw new SchemaCompatibilityError(['the database did not report the connected role']);
  }

  const roleProblems: string[] = [];

  if (role.current_user !== requiredRole) {
    roleProblems.push(`connected as ${role.current_user}, expected ${requiredRole}`);
  }

  if (role.rolbypassrls || role.rolcreatedb || role.rolcreaterole || role.rolsuper) {
    roleProblems.push(`${role.current_user} has privileged database attributes`);
  }

  if (roleProblems.length > 0) {
    throw new SchemaCompatibilityError(roleProblems);
  }

  const visible = await db.execute<{ column_name: string; table_name: string }>(sql`
    select table_name, column_name
      from information_schema.columns
     where table_schema = 'public'
  `);
  const visibleColumns = new Set(
    visible.rows.map((column) => `${column.table_name}.${column.column_name}`),
  );
  const required = EXPECTED_SCHEMA[requiredRole];
  const missing = required.flatMap((table) =>
    table.columns
      .filter((column) => !visibleColumns.has(`${table.name}.${column}`))
      .map((column) => `missing ${table.name}.${column}`),
  );

  if (missing.length > 0) {
    throw new SchemaCompatibilityError(missing);
  }

  return {
    role: requiredRole,
    database: role.current_database,
    tables: required.length,
    columns: required.reduce((count, table) => count + table.columns.length, 0),
  };
}

const compatibleApplicationDatabases = new WeakSet<object>();

/**
 * Health checks call this on the application connection. Successful checks are
 * cached per serverless instance; failures are retried, so applying a missing
 * migration makes an unhealthy instance recover without a redeploy.
 */
export async function requireCompatibleApplicationSchema(db: Database): Promise<void> {
  if (compatibleApplicationDatabases.has(db)) {
    return;
  }

  await verifyRuntimeDatabase(db, 'neuron_app');
  compatibleApplicationDatabases.add(db);
}

/** Names in one place for tests and delivery tooling. */
export const RUNTIME_DATABASE_ROLES = ['neuron_app', 'neuron_auth'] as const;
