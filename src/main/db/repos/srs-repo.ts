import type { Database } from 'better-sqlite3';
import type { SrsState } from '@shared/types/deck';
import type { SrsRow } from '@shared/types/srs';

export type { SrsRow };

export interface SrsKeyedRow extends SrsRow {
  surface: string;
  reading: string;
  jlpt_level: number | null;
  first_sentence: string | null;
}

const KNOWN_DUE = '9999-12-31';

export function createSrsRepo(db: Database) {
  const upsertStmt = db.prepare<{
    word_id: number;
    state: SrsState;
    due_date: string | null;
    stability: number;
    difficulty: number;
  }>(
    `INSERT INTO srs_state (word_id, state, due_date, stability, difficulty)
     VALUES (@word_id, @state, @due_date, @stability, @difficulty)
     ON CONFLICT(word_id) DO UPDATE SET
       state = excluded.state,
       due_date = excluded.due_date,
       stability = excluded.stability,
       difficulty = excluded.difficulty`,
  );

  const removeStmt = db.prepare<{ word_id: number }>(
    'DELETE FROM srs_state WHERE word_id = @word_id',
  );

  const getByWordId = db.prepare<{ word_id: number }, SrsRow>(
    'SELECT * FROM srs_state WHERE word_id = @word_id',
  );

  const getByKey = db.prepare<
    { surface: string; reading: string },
    SrsKeyedRow
  >(
    `SELECT s.*, w.surface, w.reading, w.jlpt_level, w.first_sentence
       FROM srs_state s
       JOIN words w ON w.id = s.word_id
      WHERE w.surface = @surface AND w.reading = @reading`,
  );

  // Used for batch fetch — accepts a JSON-encoded array of [surface,reading] pairs.
  const batchByKeys = db.prepare<
    { keys_json: string },
    SrsKeyedRow
  >(
    `WITH keys(surface, reading) AS (
       SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]')
         FROM json_each(@keys_json)
     )
     SELECT s.*, w.surface, w.reading, w.jlpt_level, w.first_sentence
       FROM srs_state s
       JOIN words w ON w.id = s.word_id
       JOIN keys k ON k.surface = w.surface AND k.reading = w.reading`,
  );

  const dueQueue = db.prepare<
    { now: string; limit: number },
    SrsKeyedRow & {
      pos: string;
      meanings_json: string;
    }
  >(
    `SELECT s.*, w.surface, w.reading, w.jlpt_level, w.first_sentence,
            w.pos, w.meanings_json
       FROM srs_state s
       JOIN words w ON w.id = s.word_id
      WHERE s.state != 'known'
        AND (s.due_date IS NULL OR s.due_date <= @now)
      ORDER BY s.due_date ASC, s.word_id ASC
      LIMIT @limit`,
  );

  const applyPatch = db.prepare<{
    word_id: number;
    state: SrsState;
    due_date: string;
    stability: number;
    difficulty: number;
    review_count: number;
    lapse_count: number;
    last_reviewed_at: string;
  }>(
    `UPDATE srs_state SET
       state = @state,
       due_date = @due_date,
       stability = @stability,
       difficulty = @difficulty,
       review_count = @review_count,
       lapse_count = @lapse_count,
       last_reviewed_at = @last_reviewed_at
     WHERE word_id = @word_id`,
  );

  function markNew(wordId: number): void {
    // Don't expose freshly-added words in the review queue immediately —
    // looking at the lookup panel and then "reviewing" 30 seconds later
    // defeats the point. Hold the first review back ~4 hours so short-term
    // memory has time to fade but the word is still reviewable same-day.
    const dueAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
    upsertStmt.run({
      word_id: wordId,
      state: 'new',
      due_date: dueAt,
      stability: 0,
      difficulty: 0,
    });
  }

  function markKnown(wordId: number): void {
    upsertStmt.run({
      word_id: wordId,
      state: 'known',
      due_date: KNOWN_DUE,
      stability: 365,
      difficulty: 1,
    });
  }

  function getByWord(wordId: number): SrsRow | null {
    return getByWordId.get({ word_id: wordId }) ?? null;
  }

  function getForKey(surface: string, reading: string): SrsKeyedRow | null {
    return getByKey.get({ surface, reading }) ?? null;
  }

  function getForKeys(
    keys: Array<{ surface: string; reading: string }>,
  ): SrsKeyedRow[] {
    if (keys.length === 0) return [];
    const json = JSON.stringify(keys.map((k) => [k.surface, k.reading]));
    return batchByKeys.all({ keys_json: json });
  }

  function remove(wordId: number): void {
    removeStmt.run({ word_id: wordId });
  }

  function getDueQueue(limit = 200): Array<
    SrsKeyedRow & { pos: string; meanings_json: string }
  > {
    return dueQueue.all({ now: new Date().toISOString(), limit });
  }

  function applyPatchSync(args: {
    wordId: number;
    state: SrsState;
    dueDate: string;
    stability: number;
    difficulty: number;
    reviewCount: number;
    lapseCount: number;
    lastReviewedAt: string;
  }): void {
    applyPatch.run({
      word_id: args.wordId,
      state: args.state,
      due_date: args.dueDate,
      stability: args.stability,
      difficulty: args.difficulty,
      review_count: args.reviewCount,
      lapse_count: args.lapseCount,
      last_reviewed_at: args.lastReviewedAt,
    });
  }

  return {
    markNew,
    markKnown,
    getByWord,
    getForKey,
    getForKeys,
    getDueQueue,
    applyPatchSync,
    remove,
  };
}

export type SrsRepo = ReturnType<typeof createSrsRepo>;
