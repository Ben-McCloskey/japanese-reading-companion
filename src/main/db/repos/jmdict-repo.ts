import type { Database } from 'better-sqlite3';
import type { JmdictEntry } from '@shared/types/jmdict';

export function createJmdictRepo(db: Database) {
  const insertEntry = db.prepare<{ ent_seq: number; data_json: string }>(
    `INSERT INTO jmdict_entries (ent_seq, data_json) VALUES (@ent_seq, @data_json)
     ON CONFLICT(ent_seq) DO UPDATE SET data_json = excluded.data_json`,
  );

  const insertIndex = db.prepare<{
    key: string;
    ent_seq: number;
    is_reading: number;
  }>(
    'INSERT INTO jmdict_index (key, ent_seq, is_reading) VALUES (@key, @ent_seq, @is_reading)',
  );

  const lookupStmt = db.prepare<
    { key: string },
    { data_json: string }
  >(
    `SELECT DISTINCT e.data_json
       FROM jmdict_index i
       JOIN jmdict_entries e ON e.ent_seq = i.ent_seq
      WHERE i.key = @key
      LIMIT 50`,
  );

  const countStmt = db.prepare<[], { c: number }>(
    'SELECT COUNT(*) AS c FROM jmdict_entries',
  );

  function bulkInsert(entries: JmdictEntry[]): void {
    const tx = db.transaction((batch: JmdictEntry[]) => {
      for (const entry of batch) {
        insertEntry.run({
          ent_seq: entry.entSeq,
          data_json: JSON.stringify(entry),
        });
        for (const k of entry.kanji) {
          insertIndex.run({ key: k, ent_seq: entry.entSeq, is_reading: 0 });
        }
        for (const r of entry.readings) {
          insertIndex.run({ key: r, ent_seq: entry.entSeq, is_reading: 1 });
        }
      }
    });
    tx(entries);
  }

  function clear(): void {
    db.exec('DELETE FROM jmdict_index; DELETE FROM jmdict_entries;');
  }

  function entryCount(): number {
    const row = countStmt.get();
    return row?.c ?? 0;
  }

  function lookup(key: string): JmdictEntry[] {
    const rows = lookupStmt.all({ key });
    return rows.map((r) => JSON.parse(r.data_json) as JmdictEntry);
  }

  return { bulkInsert, clear, entryCount, lookup };
}

export type JmdictRepo = ReturnType<typeof createJmdictRepo>;
