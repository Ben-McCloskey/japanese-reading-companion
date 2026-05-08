import type { Database } from 'better-sqlite3';
import type { SessionsRepo } from '@main/db/repos/sessions-repo';
import type { WordsRepo } from '@main/db/repos/words-repo';
import type { SrsRepo } from '@main/db/repos/srs-repo';
import type { EventLog } from './event-log';
import type { JmdictEntry } from '@shared/types/jmdict';
import type { SrsState } from '@shared/types/deck';
import type { Token } from '@shared/types/tokenizer';

interface BackfillDeps {
  db: Database;
  sessions: SessionsRepo;
  words: WordsRepo;
  srs: SrsRepo;
  eventLog: EventLog;
}

export interface BackfillResult {
  sessions: number;
  words: number;
}

/**
 * Emits sync events for everything currently in the local DB that wasn't
 * already in the event log. Run once after Phase 3 sync is set up so
 * pre-existing words/sessions/SRS state propagate to a fresh peer (e.g.
 * the iPhone on first install).
 *
 * - Sessions → `session.save` (raw_text + tokens)
 * - Words → `word.add` with the word's current SRS state captured as
 *   `srsSnapshot` so the peer arrives at the same review state.
 *
 * Idempotent at the data level: re-running emits more events but peers
 * see the same natural keys (surface+reading, raw_text), so replay is a
 * no-op upsert. The local sync_events table grows; that's acceptable
 * since the backfill is a one-shot operation.
 */
export function runBackfill(deps: BackfillDeps): BackfillResult {
  let sessionCount = 0;
  let wordCount = 0;

  // -------- sessions ------------------------------------------------------
  type SessionRow = {
    raw_text: string;
    processed_tokens_json: string;
    created_at: string;
  };
  const sessionRows = deps.db
    .prepare<[], SessionRow>(
      'SELECT raw_text, processed_tokens_json, created_at FROM sessions ORDER BY id ASC',
    )
    .all();
  for (const row of sessionRows) {
    let tokens: Token[] = [];
    try {
      const parsed: unknown = JSON.parse(row.processed_tokens_json);
      if (Array.isArray(parsed)) tokens = parsed as Token[];
    } catch {
      continue; // unparseable session — skip
    }
    deps.eventLog.append('session.save', {
      rawText: row.raw_text,
      tokens,
      createdAt: row.created_at,
    });
    sessionCount++;
  }

  // -------- words + srs ---------------------------------------------------
  type WordWithSrs = {
    surface: string;
    reading: string;
    jlpt_level: number | null;
    pos: string;
    meanings_json: string;
    first_sentence: string | null;
    first_session_raw_text: string | null;
    state: string;
    due_date: string | null;
    stability: number;
    difficulty: number;
    review_count: number;
    lapse_count: number;
    last_reviewed_at: string | null;
  };
  const wordRows = deps.db
    .prepare<[], WordWithSrs>(
      `SELECT w.surface, w.reading, w.jlpt_level, w.pos, w.meanings_json,
              w.first_sentence,
              s.raw_text AS first_session_raw_text,
              srs.state, srs.due_date, srs.stability, srs.difficulty,
              srs.review_count, srs.lapse_count, srs.last_reviewed_at
         FROM words w
         JOIN srs_state srs ON srs.word_id = w.id
         LEFT JOIN sessions s ON s.id = w.first_session_id
         ORDER BY w.id ASC`,
    )
    .all();
  for (const row of wordRows) {
    let meanings: JmdictEntry[] = [];
    try {
      const parsed: unknown = JSON.parse(row.meanings_json);
      if (Array.isArray(parsed)) meanings = parsed as JmdictEntry[];
    } catch {
      // continue with empty meanings — a word with broken meanings_json is
      // already a problem, but we still want it to sync.
    }
    deps.eventLog.append('word.add', {
      surface: row.surface,
      reading: row.reading,
      jlptLevel: row.jlpt_level,
      pos: row.pos,
      meanings,
      firstSentence: row.first_sentence,
      firstSessionRawText: row.first_session_raw_text,
      asKnown: row.state === 'known',
      srsSnapshot: {
        state: row.state as SrsState,
        dueDate: row.due_date,
        stability: row.stability,
        difficulty: row.difficulty,
        reviewCount: row.review_count,
        lapseCount: row.lapse_count,
        lastReviewedAt: row.last_reviewed_at,
      },
    });
    wordCount++;
  }

  return { sessions: sessionCount, words: wordCount };
}
