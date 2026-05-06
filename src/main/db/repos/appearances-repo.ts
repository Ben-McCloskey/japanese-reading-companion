import type { Database } from 'better-sqlite3';

export interface AppearanceRow {
  word_id: number;
  session_id: number;
  count: number;
}

export function createAppearancesRepo(db: Database) {
  const upsert = db.prepare<AppearanceRow>(
    `INSERT INTO word_session_appearances (word_id, session_id, count)
     VALUES (@word_id, @session_id, @count)
     ON CONFLICT(word_id, session_id) DO UPDATE SET count = excluded.count`,
  );

  const removeForSession = db.prepare<{ session_id: number }>(
    'DELETE FROM word_session_appearances WHERE session_id = @session_id',
  );

  const totalForWord = db.prepare<
    { word_id: number },
    { total: number | null }
  >(
    'SELECT SUM(count) AS total FROM word_session_appearances WHERE word_id = @word_id',
  );

  function setForSession(sessionId: number, counts: Map<number, number>): void {
    const tx = db.transaction(() => {
      // Replace this session's counts atomically.
      removeForSession.run({ session_id: sessionId });
      for (const [wordId, count] of counts) {
        if (count <= 0) continue;
        upsert.run({ word_id: wordId, session_id: sessionId, count });
      }
    });
    tx();
  }

  function setForWord(wordId: number, perSession: Map<number, number>): void {
    const tx = db.transaction(() => {
      for (const [sessionId, count] of perSession) {
        if (count <= 0) continue;
        upsert.run({ word_id: wordId, session_id: sessionId, count });
      }
    });
    tx();
  }

  function getTotalForWord(wordId: number): number {
    const row = totalForWord.get({ word_id: wordId });
    return row?.total ?? 0;
  }

  return { setForSession, setForWord, getTotalForWord };
}

export type AppearancesRepo = ReturnType<typeof createAppearancesRepo>;
