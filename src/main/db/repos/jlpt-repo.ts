import type { Database } from 'better-sqlite3';

export interface JlptEntry {
  key: string;
  level: number;
}

export function createJlptRepo(db: Database) {
  const insert = db.prepare<{ key: string; level: number }>(
    `INSERT INTO jlpt_levels (key, level) VALUES (@key, @level)
     ON CONFLICT(key) DO UPDATE SET level = excluded.level`,
  );

  const lookup = db.prepare<{ key: string }, { level: number }>(
    'SELECT level FROM jlpt_levels WHERE key = @key',
  );

  const count = db.prepare<[], { c: number }>(
    'SELECT COUNT(*) AS c FROM jlpt_levels',
  );

  function bulkInsert(entries: JlptEntry[]): void {
    if (entries.length === 0) return;
    const tx = db.transaction((batch: JlptEntry[]) => {
      for (const e of batch) {
        if (e.level < 1 || e.level > 5) continue;
        insert.run({ key: e.key, level: e.level });
      }
    });
    tx(entries);
  }

  function levelFor(key: string): number | null {
    const row = lookup.get({ key });
    return row?.level ?? null;
  }

  function size(): number {
    return count.get()?.c ?? 0;
  }

  return { bulkInsert, levelFor, size };
}

export type JlptRepo = ReturnType<typeof createJlptRepo>;
