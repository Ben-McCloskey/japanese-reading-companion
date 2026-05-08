import type { Database } from 'better-sqlite3';
import migration0001 from './0001_init.sql?raw';
import migration0002 from './0002_app_tables.sql?raw';
import migration0003 from './0003_appearances.sql?raw';
import migration0004 from './0004_sync_events.sql?raw';

type Migration = { version: number; name: string; sql: string };

const MIGRATIONS: Migration[] = [
  { version: 1, name: '0001_init', sql: migration0001 },
  { version: 2, name: '0002_app_tables', sql: migration0002 },
  { version: 3, name: '0003_appearances', sql: migration0003 },
  { version: 4, name: '0004_sync_events', sql: migration0004 },
];

const BOOKKEEPING_SQL = `
  CREATE TABLE IF NOT EXISTS _migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

export function runMigrations(db: Database): void {
  db.exec(BOOKKEEPING_SQL);

  const appliedRows = db
    .prepare('SELECT version FROM _migrations ORDER BY version ASC')
    .all() as Array<{ version: number }>;
  const applied = new Set(appliedRows.map((r) => r.version));

  const pending = MIGRATIONS.filter((m) => !applied.has(m.version)).sort(
    (a, b) => a.version - b.version,
  );

  if (pending.length === 0) return;

  const insertApplied = db.prepare(
    'INSERT INTO _migrations (version, name) VALUES (?, ?)',
  );

  const apply = db.transaction((migrations: Migration[]) => {
    for (const m of migrations) {
      db.exec(m.sql);
      insertApplied.run(m.version, m.name);
    }
  });

  apply(pending);
}
