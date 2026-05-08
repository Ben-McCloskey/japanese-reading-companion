import type { Database } from 'better-sqlite3';
import type {
  WordListFilter,
  WordListItem,
  SrsState,
} from '@shared/types/deck';

export interface WordRow {
  id: number;
  surface: string;
  reading: string;
  jlpt_level: number | null;
  pos: string;
  meanings_json: string;
  example_sentences_json: string | null;
  created_at: string;
  first_session_id: number | null;
  first_sentence: string | null;
}

export interface UpsertWordArgs {
  surface: string;
  reading: string;
  jlptLevel: number | null;
  pos: string;
  meaningsJson: string;
  exampleSentencesJson: string | null;
  firstSessionId: number | null;
  firstSentence: string | null;
}

export function createWordsRepo(db: Database) {
  const findByKey = db.prepare<
    { surface: string; reading: string },
    WordRow
  >(
    'SELECT * FROM words WHERE surface = @surface AND reading = @reading',
  );

  const insert = db.prepare<{
    surface: string;
    reading: string;
    jlpt_level: number | null;
    pos: string;
    meanings_json: string;
    example_sentences_json: string | null;
    first_session_id: number | null;
    first_sentence: string | null;
  }>(
    `INSERT INTO words (
       surface, reading, jlpt_level, pos, meanings_json,
       example_sentences_json, first_session_id, first_sentence
     ) VALUES (
       @surface, @reading, @jlpt_level, @pos, @meanings_json,
       @example_sentences_json, @first_session_id, @first_sentence
     )`,
  );

  const updateMeta = db.prepare<{
    id: number;
    jlpt_level: number | null;
    pos: string;
    meanings_json: string;
    example_sentences_json: string | null;
  }>(
    `UPDATE words
        SET jlpt_level = @jlpt_level,
            pos = @pos,
            meanings_json = @meanings_json,
            example_sentences_json = @example_sentences_json
      WHERE id = @id`,
  );

  const remove = db.prepare<{ id: number }>(
    'DELETE FROM words WHERE id = @id',
  );

  function upsert(args: UpsertWordArgs): WordRow {
    const existing = findByKey.get({
      surface: args.surface,
      reading: args.reading,
    });
    if (existing) {
      updateMeta.run({
        id: existing.id,
        jlpt_level: args.jlptLevel,
        pos: args.pos,
        meanings_json: args.meaningsJson,
        example_sentences_json: args.exampleSentencesJson,
      });
      return findByKey.get({
        surface: args.surface,
        reading: args.reading,
      }) as WordRow;
    }
    insert.run({
      surface: args.surface,
      reading: args.reading,
      jlpt_level: args.jlptLevel,
      pos: args.pos,
      meanings_json: args.meaningsJson,
      example_sentences_json: args.exampleSentencesJson,
      first_session_id: args.firstSessionId,
      first_sentence: args.firstSentence,
    });
    return findByKey.get({
      surface: args.surface,
      reading: args.reading,
    }) as WordRow;
  }

  function getByKey(surface: string, reading: string): WordRow | null {
    return findByKey.get({ surface, reading }) ?? null;
  }

  const findById = db.prepare<{ id: number }, WordRow>(
    'SELECT * FROM words WHERE id = @id',
  );

  function getById(id: number): WordRow | null {
    return findById.get({ id }) ?? null;
  }

  // ----- list / bulk operations -----------------------------------------

  function list(filter: WordListFilter = {}): WordListItem[] {
    const where: string[] = ['1=1'];
    const params: Record<string, unknown> = {};

    const states = filter.states && filter.states.length > 0 ? filter.states : null;
    if (states) {
      const placeholders = states.map((_, i) => `@state${i}`).join(',');
      where.push(`s.state IN (${placeholders})`);
      states.forEach((st, i) => {
        params[`state${i}`] = st;
      });
    }

    const levels =
      filter.jlptLevels && filter.jlptLevels.length > 0
        ? filter.jlptLevels
        : null;
    if (levels) {
      const placeholders = levels.map((_, i) => `@lvl${i}`).join(',');
      where.push(`w.jlpt_level IN (${placeholders})`);
      levels.forEach((lv, i) => {
        params[`lvl${i}`] = lv;
      });
    }

    const search = filter.search?.trim();
    if (search) {
      where.push('(w.surface LIKE @search OR w.reading LIKE @search)');
      params.search = `%${search}%`;
    }

    const sql = `
      SELECT w.id, w.surface, w.reading, w.jlpt_level, w.pos,
             w.first_sentence, w.created_at,
             s.state, s.due_date, s.review_count, s.lapse_count,
             s.stability, s.last_reviewed_at,
             COALESCE(ap.total, 0) AS seen_count
        FROM words w
        JOIN srs_state s ON s.word_id = w.id
        LEFT JOIN (
          SELECT word_id, SUM(count) AS total
            FROM word_session_appearances
           GROUP BY word_id
        ) ap ON ap.word_id = w.id
       WHERE ${where.join(' AND ')}
       ORDER BY w.created_at DESC
       LIMIT 1000
    `;

    type Row = {
      id: number;
      surface: string;
      reading: string;
      jlpt_level: number | null;
      pos: string;
      first_sentence: string | null;
      created_at: string;
      state: string;
      due_date: string | null;
      review_count: number;
      lapse_count: number;
      stability: number;
      last_reviewed_at: string | null;
      seen_count: number;
    };

    const rows = db.prepare(sql).all(params) as Row[];
    return rows.map((r) => ({
      id: r.id,
      surface: r.surface,
      reading: r.reading,
      jlptLevel: r.jlpt_level,
      pos: r.pos,
      firstSentence: r.first_sentence,
      createdAt: r.created_at,
      state: r.state as SrsState,
      dueDate: r.due_date,
      reviewCount: r.review_count,
      lapseCount: r.lapse_count,
      stability: r.stability,
      lastReviewedAt: r.last_reviewed_at,
      seenCount: r.seen_count ?? 0,
    }));
  }

  const markKnownStmt = db.prepare<{
    id: number;
  }>(
    `UPDATE srs_state
        SET state = 'known',
            due_date = '9999-12-31',
            stability = 365,
            difficulty = 1
      WHERE word_id = @id`,
  );

  function bulkRemove(ids: number[]): number {
    if (ids.length === 0) return 0;
    const tx = db.transaction((batch: number[]) => {
      let removed = 0;
      for (const id of batch) {
        const r = remove.run({ id });
        removed += r.changes;
      }
      return removed;
    });
    return tx(ids);
  }

  function bulkMarkKnown(ids: number[]): number {
    if (ids.length === 0) return 0;
    const tx = db.transaction((batch: number[]) => {
      let updated = 0;
      for (const id of batch) {
        const r = markKnownStmt.run({ id });
        updated += r.changes;
      }
      return updated;
    });
    return tx(ids);
  }

  return {
    upsert,
    getByKey,
    getById,
    remove(id: number): void {
      remove.run({ id });
    },
    list,
    bulkRemove,
    bulkMarkKnown,
  };
}

export type WordsRepo = ReturnType<typeof createWordsRepo>;
