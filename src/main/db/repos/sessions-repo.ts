import type { Database } from 'better-sqlite3';
import type { SessionListItem } from '@shared/types/sessions';

export interface SessionRow {
  id: number;
  created_at: string;
  title: string;
  raw_text: string;
  processed_tokens_json: string;
}

export interface SessionSummary {
  id: number;
  createdAt: string;
  title: string;
  rawText: string;
}

const TITLE_LEN = 30;

function buildTitle(rawText: string): string {
  const trimmed = rawText.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= TITLE_LEN) return trimmed;
  return trimmed.slice(0, TITLE_LEN) + '…';
}

export function createSessionsRepo(db: Database) {
  const insert = db.prepare<{
    title: string;
    raw_text: string;
    processed_tokens_json: string;
  }>(
    `INSERT INTO sessions (title, raw_text, processed_tokens_json)
     VALUES (@title, @raw_text, @processed_tokens_json)`,
  );

  const findRecentByText = db.prepare<
    { raw_text: string },
    SessionRow
  >(
    `SELECT * FROM sessions
      WHERE raw_text = @raw_text
      ORDER BY id DESC
      LIMIT 1`,
  );

  const updateTokens = db.prepare<{
    id: number;
    processed_tokens_json: string;
  }>(
    `UPDATE sessions SET processed_tokens_json = @processed_tokens_json WHERE id = @id`,
  );

  const list = db.prepare<[], SessionRow>(
    'SELECT * FROM sessions ORDER BY created_at DESC LIMIT 200',
  );

  const getById = db.prepare<{ id: number }, SessionRow>(
    'SELECT * FROM sessions WHERE id = @id',
  );

  const remove = db.prepare<{ id: number }>(
    'DELETE FROM sessions WHERE id = @id',
  );

  /**
   * Save a session. If the most recent session has identical raw_text, reuse
   * its id (and refresh the parsed-tokens blob); otherwise insert a new row.
   * This avoids cluttering the sessions list when a user re-tokenizes the same
   * text repeatedly.
   */
  function saveOrReuse(args: {
    rawText: string;
    processedTokensJson: string;
  }): number {
    const existing = findRecentByText.get({ raw_text: args.rawText });
    if (existing) {
      updateTokens.run({
        id: existing.id,
        processed_tokens_json: args.processedTokensJson,
      });
      return existing.id;
    }
    const result = insert.run({
      title: buildTitle(args.rawText),
      raw_text: args.rawText,
      processed_tokens_json: args.processedTokensJson,
    });
    return Number(result.lastInsertRowid);
  }

  const listWithStats = db.prepare<[], {
    id: number;
    created_at: string;
    title: string;
    raw_text: string;
    new_words_count: number;
  }>(
    `SELECT s.id, s.created_at, s.title, s.raw_text,
            COALESCE(
              (SELECT COUNT(*) FROM words w WHERE w.first_session_id = s.id),
              0
            ) AS new_words_count
       FROM sessions s
       ORDER BY s.created_at DESC
       LIMIT 200`,
  );

  return {
    saveOrReuse,
    list(): SessionSummary[] {
      return list.all().map((r) => ({
        id: r.id,
        createdAt: r.created_at,
        title: r.title,
        rawText: r.raw_text,
      }));
    },
    listWithStats(): SessionListItem[] {
      return listWithStats.all().map((r) => ({
        id: r.id,
        createdAt: r.created_at,
        title: r.title,
        rawText: r.raw_text,
        newWordsCount: r.new_words_count,
      }));
    },
    get(id: number): SessionRow | null {
      return getById.get({ id }) ?? null;
    },
    remove(id: number): void {
      remove.run({ id });
    },
  };
}

export type SessionsRepo = ReturnType<typeof createSessionsRepo>;
