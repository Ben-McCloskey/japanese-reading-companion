import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from '@capacitor-community/sqlite';

// Migrations live in the main-process tree but the .sql files themselves
// have no Node dependencies. Vite's `?raw` works in any target.
import sql0001 from '../main/db/migrations/0001_init.sql?raw';
import sql0002 from '../main/db/migrations/0002_app_tables.sql?raw';
import sql0003 from '../main/db/migrations/0003_appearances.sql?raw';
import sql0004 from '../main/db/migrations/0004_sync_events.sql?raw';

const DB_NAME = 'jrc';

const MIGRATIONS = [
  { version: 1, name: '0001_init', sql: sql0001 },
  { version: 2, name: '0002_app_tables', sql: sql0002 },
  { version: 3, name: '0003_appearances', sql: sql0003 },
  { version: 4, name: '0004_sync_events', sql: sql0004 },
];

const sqlite = new SQLiteConnection(CapacitorSQLite);
let dbPromise: Promise<SQLiteDBConnection> | null = null;

export function db(): Promise<SQLiteDBConnection> {
  if (!dbPromise) dbPromise = openDb();
  return dbPromise;
}

async function openDb(): Promise<SQLiteDBConnection> {
  // Capacitor SQLite needs a consistency check across page reloads on iOS.
  // Without it, retrieveConnection / createConnection can throw "already
  // open" or "no connection" errors after a webview reload.
  await sqlite.checkConnectionsConsistency();
  const exists = (await sqlite.isConnection(DB_NAME, false)).result === true;
  const conn = exists
    ? await sqlite.retrieveConnection(DB_NAME, false)
    : await sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false);

  await conn.open();
  await conn.execute('PRAGMA foreign_keys = ON;');

  // Bookkeeping table mirrors the Electron side.
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const appliedRes = await conn.query('SELECT version FROM _migrations');
  const applied = new Set<number>(
    (appliedRes.values ?? []).map((r) => (r as { version: number }).version),
  );

  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    await conn.execute(m.sql);
    await conn.run(
      'INSERT INTO _migrations (version, name) VALUES (?, ?)',
      [m.version, m.name],
    );
  }

  // First-launch deviceId. Stable across launches, distinct per device.
  // Used by the sync engine to attribute events to this iPhone.
  const dev = await conn.query(
    "SELECT value FROM settings WHERE key = 'deviceId'",
  );
  if (!dev.values || dev.values.length === 0) {
    const id = crypto.randomUUID();
    await conn.run(
      "INSERT INTO settings (key, value) VALUES ('deviceId', ?)",
      [id],
    );
  }

  return conn;
}

/**
 * Run a SELECT and return the rows array, narrowed to the caller's expected
 * shape. The Capacitor plugin gives us untyped rows, so we cast at the
 * boundary.
 */
export async function query<T>(
  sql: string,
  values: unknown[] = [],
): Promise<T[]> {
  const conn = await db();
  const res = await conn.query(sql, values);
  return (res.values ?? []) as T[];
}

export async function queryOne<T>(
  sql: string,
  values: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, values);
  return rows[0] ?? null;
}

/** Run an INSERT/UPDATE/DELETE and return the lastId for inserts. */
export async function run(
  sql: string,
  values: unknown[] = [],
): Promise<{ changes: number; lastId: number }> {
  const conn = await db();
  const res = await conn.run(sql, values);
  return {
    changes: res.changes?.changes ?? 0,
    lastId: res.changes?.lastId ?? 0,
  };
}

/** Run a multi-statement script as a transaction. */
export async function runTransaction(
  statements: Array<{ statement: string; values?: unknown[] }>,
): Promise<void> {
  const conn = await db();
  await conn.executeTransaction(
    statements.map((s) => ({
      statement: s.statement,
      values: s.values ?? [],
    })),
  );
}
