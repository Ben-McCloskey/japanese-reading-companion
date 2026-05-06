import type { Database } from 'better-sqlite3';

export function createSettingsRepo(db: Database) {
  const selectStmt = db.prepare<{ key: string }, { value: string }>(
    'SELECT value FROM settings WHERE key = @key',
  );
  const upsertStmt = db.prepare<{ key: string; value: string }>(
    `INSERT INTO settings (key, value) VALUES (@key, @value)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );

  return {
    get(key: string): string | null {
      const row = selectStmt.get({ key });
      return row?.value ?? null;
    },
    set(key: string, value: string): void {
      upsertStmt.run({ key, value });
    },
  };
}

export type SettingsRepo = ReturnType<typeof createSettingsRepo>;
