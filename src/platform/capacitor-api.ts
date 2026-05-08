import kuromoji, {
  type IpadicFeatures,
  type Tokenizer as KuroTokenizer,
} from 'kuromoji';
import {
  installKuromojiLoaderPatch,
  onKuromojiProgress,
  getKuromojiProgress,
} from './kuromoji-loader';
import type { Api, Unsubscribe } from '@shared/api';
import type { Result } from '@shared/result';
import { ok, err } from '@shared/result';
import type { JmdictEntry } from '@shared/types/jmdict';
import type { Token } from '@shared/types/tokenizer';
import type { TokenizerStatus } from '@shared/ipc';
import type {
  DeckEntry,
  SrsState,
  WordListItem,
  WordListFilter,
} from '@shared/types/deck';
import type { SrsRow } from '@shared/types/srs';
import { applyRating, type FsrsRating } from '../main/services/srs/fsrs';
import { db, query, queryOne, run, runTransaction } from './capacitor-db';
import {
  getCachedStatus as getDictStatusCached,
  importJmdict,
  refreshStatusFromDb,
  subscribeStatus as subscribeDictStatus,
} from './capacitor-jmdict';
import { append as appendSyncEvent, deviceId as getDeviceId } from './capacitor-event-log';
import { createCapacitorSyncEngine } from './capacitor-sync-engine';
import { SYNCED_SETTING_KEYS } from '@shared/types/sync';

// ---------------------------------------------------------------------------
// Helpers

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function tryAsync<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return ok(await fn());
  } catch (e) {
    return err(errMsg(e));
  }
}

const noopUnsub: Unsubscribe = () => {
  /* no-op — events are not yet plumbed on iOS. */
};

function katakanaToHiragana(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0x30a1 && c <= 0x30f6) out += String.fromCharCode(c - 0x60);
    else out += s.charAt(i);
  }
  return out;
}

function safeParseEntries(json: string | null | undefined): JmdictEntry[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as JmdictEntry[]) : [];
  } catch {
    return [];
  }
}

function rowToDeckEntry(row: {
  word_id: number;
  surface: string;
  reading: string;
  state: string;
  due_date: string | null;
  review_count: number;
  lapse_count: number;
  last_reviewed_at: string | null;
  jlpt_level: number | null;
  first_sentence: string | null;
}): DeckEntry {
  return {
    wordId: row.word_id,
    surface: row.surface,
    reading: row.reading,
    state: row.state as SrsState,
    dueDate: row.due_date,
    reviewCount: row.review_count,
    lapseCount: row.lapse_count,
    lastReviewedAt: row.last_reviewed_at,
    jlptLevel: row.jlpt_level,
    firstSentence: row.first_sentence,
  };
}

const KNOWN_DUE = '9999-12-31';
const NEW_FIRST_REVIEW_DELAY_MS = 4 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Kuromoji bring-up
//
// The dict files live in the bundle at `./kuromoji-dict/` (copied there by
// vite.web.config.ts → copyKuromojiDict). kuromoji.builder defaults to its
// browser loader (XHR) thanks to the `browser` field in the package, so we
// just point dicPath at the relative URL and let it gunzip in-process.
//
// Warmup is started eagerly at module load so the trie is ready by the time
// the user navigates to Read. ~2-3s on iPhone, ~1-2s on Mac.

type KuroTok = KuroTokenizer<IpadicFeatures>;

// kuromoji's DictionaryLoader fetches exactly these 12 .dat.gz files;
// the count is stable across kuromoji versions we care about.
const KUROMOJI_FILE_COUNT = 12;

let kuroInstance: KuroTok | null = null;
let kuroError: string | null = null;
let kuroPromise: Promise<void> | null = null;
const kuroListeners = new Set<(s: TokenizerStatus) => void>();

function notifyKuroListeners(status: TokenizerStatus): void {
  for (const cb of kuroListeners) cb(status);
}

function ensureTokenizer(): Promise<void> {
  if (kuroPromise) return kuroPromise;
  // Swap kuromoji's XHR loader for a fetch-based one before the builder
  // touches the prototype. See kuromoji-loader.ts for why.
  installKuromojiLoaderPatch();

  // Mirror loader progress (per-file load + any error) into the tokenizer
  // status so the UI shows "Loading 3 of 12…" instead of just "Warming…",
  // and so a 404 / timeout surfaces as a visible 'failed' state instead of
  // hanging forever.
  onKuromojiProgress((p) => {
    if (p.error && !kuroError) {
      kuroError = p.error;
      notifyKuroListeners({ kind: 'failed', error: kuroError });
      return;
    }
    if (kuroInstance == null && !kuroError) {
      notifyKuroListeners({
        kind: 'warming',
        loaded: p.loaded.length,
        total: KUROMOJI_FILE_COUNT,
      });
    }
  });

  kuroPromise = new Promise<void>((resolve) => {
    kuromoji.builder({ dicPath: './kuromoji-dict' }).build((e, t) => {
      if (e) {
        const progress = getKuromojiProgress();
        const detail = progress.error ?? (e instanceof Error ? e.message : String(e));
        kuroError = detail;
         
        console.error('[kuromoji] build failed:', kuroError);
        notifyKuroListeners({ kind: 'failed', error: kuroError });
      } else {
        kuroInstance = t;
        notifyKuroListeners({ kind: 'ready' });
      }
      resolve();
    });
  });
  return kuroPromise;
}

function mapToken(t: IpadicFeatures): Token {
  const reading = t.reading && t.reading !== '*' ? t.reading : null;
  const basicForm =
    t.basic_form && t.basic_form !== '*' ? t.basic_form : t.surface_form;
  const detail = [t.pos_detail_1, t.pos_detail_2, t.pos_detail_3].filter(
    (d): d is string => Boolean(d) && d !== '*',
  );
  return {
    surface: t.surface_form,
    basicForm,
    reading,
    pos: t.pos,
    posDetail: detail,
    conjugatedType:
      t.conjugated_type && t.conjugated_type !== '*' ? t.conjugated_type : null,
    conjugatedForm:
      t.conjugated_form && t.conjugated_form !== '*' ? t.conjugated_form : null,
  };
}

// ---------------------------------------------------------------------------
// Sync engine (constructed before the api object so methods can reference
// it without a TDZ dance). Started after the DB is ready, see end of file.

const syncEngine = createCapacitorSyncEngine();

// ---------------------------------------------------------------------------
// Api implementation

export const capacitorApi: Api = {
  ping: async () => ok('pong'),

  // settings -----------------------------------------------------------------
  getSetting: (key) =>
    tryAsync(async () => {
      const row = await queryOne<{ value: string }>(
        'SELECT value FROM settings WHERE key = ?',
        [key],
      );
      return row?.value ?? null;
    }),

  setSetting: (key, value) =>
    tryAsync(async () => {
      await run(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [key, value],
      );
      if (SYNCED_SETTING_KEYS.has(key)) {
        await appendSyncEvent('settings.set', { key, value });
        syncEngine.notifyLocalChange();
      }
    }),

  // dictionary ---------------------------------------------------------------
  // JMdict on iOS is imported on demand from edrdg.org. Sync hydrates the
  // word list but does NOT carry the dictionary itself across devices —
  // that would balloon iCloud storage. Each device imports its own copy.
  getDictStatus: async () => {
    const cached = getDictStatusCached();
    // Mid-import statuses are authoritative — don't re-query the DB.
    if (cached.kind === 'importing' || cached.kind === 'failed') {
      return ok(cached);
    }
    return ok(await refreshStatusFromDb());
  },

  importDict: () =>
    tryAsync(async () => {
      // Fire-and-forget: kick off the import but don't wait for it. Status
      // updates flow via onDictProgress so the UI can render progress.
      void importJmdict();
    }),

  lookupDict: (key) =>
    tryAsync(async () => {
      const rows = await query<{ data_json: string }>(
        `SELECT DISTINCT e.data_json
           FROM jmdict_index i
           JOIN jmdict_entries e ON e.ent_seq = i.ent_seq
          WHERE i.key = ?
          LIMIT 50`,
        [key],
      );
      return rows.map((r) => JSON.parse(r.data_json) as JmdictEntry);
    }),

  lookupWord: (req) =>
    tryAsync(async () => {
      const candidates: string[] = [];
      if (req.basicForm) candidates.push(req.basicForm);
      if (req.surface && req.surface !== req.basicForm) candidates.push(req.surface);
      if (req.reading) {
        const hira = katakanaToHiragana(req.reading);
        if (!candidates.includes(hira)) candidates.push(hira);
      }
      for (const key of candidates) {
        const rows = await query<{ data_json: string }>(
          `SELECT DISTINCT e.data_json
             FROM jmdict_index i
             JOIN jmdict_entries e ON e.ent_seq = i.ent_seq
            WHERE i.key = ?
            LIMIT 50`,
          [key],
        );
        if (rows.length === 0) continue;
        const entries = rows.map((r) => JSON.parse(r.data_json) as JmdictEntry);
        const lvlRow = await queryOne<{ level: number }>(
          'SELECT level FROM jlpt_levels WHERE key = ? LIMIT 1',
          [key],
        );
        return { matchedKey: key, entries, jlptLevel: lvlRow?.level ?? null };
      }
      return null;
    }),

  onDictProgress: (cb) => subscribeDictStatus(cb),

  // tokenizer ---------------------------------------------------------------
  getTokenizerStatus: async () => {
    if (kuroInstance) return ok({ kind: 'ready' } as const);
    if (kuroError) return ok({ kind: 'failed', error: kuroError } as const);
    return ok({ kind: 'warming' } as const);
  },

  onTokenizerReady: (cb) => {
    // Already-resolved cases fire on the next microtask so callers can store
    // the unsub before the listener is invoked.
    if (kuroInstance) {
      queueMicrotask(() => cb({ kind: 'ready' }));
      return noopUnsub;
    }
    if (kuroError) {
      const error = kuroError;
      queueMicrotask(() => cb({ kind: 'failed', error }));
      return noopUnsub;
    }
    kuroListeners.add(cb);
    return () => {
      kuroListeners.delete(cb);
    };
  },

  tokenize: (text) =>
    tryAsync(async () => {
      await ensureTokenizer();
      if (!kuroInstance) {
        throw new Error(kuroError ?? 'Tokenizer failed to load');
      }
      return kuroInstance.tokenize(text).map(mapToken);
    }),

  // sessions ----------------------------------------------------------------
  saveSession: (req) =>
    tryAsync(async () => {
      const existing = await queryOne<{ id: number }>(
        'SELECT id FROM sessions WHERE raw_text = ? ORDER BY id DESC LIMIT 1',
        [req.rawText],
      );
      let savedId: number;
      if (existing) {
        await run(
          'UPDATE sessions SET processed_tokens_json = ? WHERE id = ?',
          [JSON.stringify(req.tokens), existing.id],
        );
        savedId = existing.id;
      } else {
        const title = makeTitle(req.rawText);
        const result = await run(
          `INSERT INTO sessions (title, raw_text, processed_tokens_json)
           VALUES (?, ?, ?)`,
          [title, req.rawText, JSON.stringify(req.tokens)],
        );
        savedId = result.lastId;
      }
      await appendSyncEvent('session.save', {
        rawText: req.rawText,
        tokens: req.tokens,
        createdAt: new Date().toISOString(),
      });
      syncEngine.notifyLocalChange();
      return { id: savedId };
    }),

  listSessions: () =>
    tryAsync(async () => {
      const rows = await query<{
        id: number;
        created_at: string;
        title: string;
        raw_text: string;
        new_words_count: number;
      }>(`
        SELECT s.id, s.created_at, s.title, s.raw_text,
               COALESCE(
                 (SELECT COUNT(*) FROM words w WHERE w.first_session_id = s.id),
                 0
               ) AS new_words_count
          FROM sessions s
          ORDER BY s.created_at DESC
          LIMIT 200
      `);
      return rows.map((r) => ({
        id: r.id,
        createdAt: r.created_at,
        title: r.title,
        rawText: r.raw_text,
        newWordsCount: r.new_words_count,
      }));
    }),

  getSession: (req) =>
    tryAsync(async () => {
      const row = await queryOne<{
        id: number;
        created_at: string;
        title: string;
        raw_text: string;
        processed_tokens_json: string;
      }>('SELECT * FROM sessions WHERE id = ?', [req.id]);
      if (!row) return null;
      let tokens: Token[] = [];
      try {
        const parsed = JSON.parse(row.processed_tokens_json);
        if (Array.isArray(parsed)) tokens = parsed as Token[];
      } catch {
        /* fall through with empty tokens */
      }
      return {
        id: row.id,
        createdAt: row.created_at,
        title: row.title,
        rawText: row.raw_text,
        tokens,
      };
    }),

  deleteSession: (req) =>
    tryAsync(async () => {
      const row = await queryOne<{ raw_text: string }>(
        'SELECT raw_text FROM sessions WHERE id = ?',
        [req.id],
      );
      await run('DELETE FROM sessions WHERE id = ?', [req.id]);
      if (row) {
        await appendSyncEvent('session.delete', { rawText: row.raw_text });
        syncEngine.notifyLocalChange();
      }
    }),

  // deck --------------------------------------------------------------------
  addToDeck: (req) =>
    tryAsync(async () => {
      // Upsert the word row.
      const existing = await queryOne<{ id: number }>(
        'SELECT id FROM words WHERE surface = ? AND reading = ?',
        [req.surface, req.reading],
      );
      const meaningsJson = JSON.stringify(req.meanings);
      const examples = collectExamples(req.meanings);
      const examplesJson = examples.length > 0 ? JSON.stringify(examples) : null;
      let wordId: number;
      if (existing) {
        await run(
          `UPDATE words SET jlpt_level = ?, pos = ?, meanings_json = ?, example_sentences_json = ?
            WHERE id = ?`,
          [req.jlptLevel, req.pos, meaningsJson, examplesJson, existing.id],
        );
        wordId = existing.id;
      } else {
        const result = await run(
          `INSERT INTO words (
             surface, reading, jlpt_level, pos, meanings_json,
             example_sentences_json, first_session_id, first_sentence
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            req.surface,
            req.reading,
            req.jlptLevel,
            req.pos,
            meaningsJson,
            examplesJson,
            req.sessionId,
            req.firstSentence,
          ],
        );
        wordId = result.lastId;
      }

      // Initialize SRS state if absent. Re-adding an existing word doesn't
      // reset its review history.
      const srsRow = await queryOne<SrsRow>(
        'SELECT * FROM srs_state WHERE word_id = ?',
        [wordId],
      );
      if (!srsRow) {
        if (req.asKnown) {
          await run(
            `INSERT INTO srs_state (word_id, state, due_date, stability, difficulty)
             VALUES (?, 'known', ?, 365, 1)`,
            [wordId, KNOWN_DUE],
          );
        } else {
          // 4-hour delay before first review (matches Mac side).
          const dueAt = new Date(Date.now() + NEW_FIRST_REVIEW_DELAY_MS).toISOString();
          await run(
            `INSERT INTO srs_state (word_id, state, due_date, stability, difficulty)
             VALUES (?, 'new', ?, 0, 0)`,
            [wordId, dueAt],
          );
        }
      } else if (req.asKnown && srsRow.state !== 'known') {
        await run(
          `UPDATE srs_state SET state = 'known', due_date = ?, stability = 365, difficulty = 1
            WHERE word_id = ?`,
          [KNOWN_DUE, wordId],
        );
      }

      const entryRow = await queryOne<{
        word_id: number;
        surface: string;
        reading: string;
        state: string;
        due_date: string | null;
        review_count: number;
        lapse_count: number;
        last_reviewed_at: string | null;
        jlpt_level: number | null;
        first_sentence: string | null;
      }>(
        `SELECT s.word_id, w.surface, w.reading, s.state, s.due_date,
                s.review_count, s.lapse_count, s.last_reviewed_at,
                w.jlpt_level, w.first_sentence
           FROM srs_state s JOIN words w ON w.id = s.word_id
          WHERE s.word_id = ?`,
        [wordId],
      );
      if (!entryRow) throw new Error('SRS state was not created');

      // Resolve session id → raw_text so peers can find their own copy.
      const firstSessionRawText = req.sessionId != null
        ? (
            await queryOne<{ raw_text: string }>(
              'SELECT raw_text FROM sessions WHERE id = ?',
              [req.sessionId],
            )
          )?.raw_text ?? null
        : null;
      await appendSyncEvent('word.add', {
        surface: req.surface,
        reading: req.reading,
        jlptLevel: req.jlptLevel,
        pos: req.pos,
        meanings: req.meanings,
        firstSentence: req.firstSentence,
        firstSessionRawText,
        asKnown: req.asKnown ?? false,
      });
      syncEngine.notifyLocalChange();

      return rowToDeckEntry(entryRow);
    }),

  removeFromDeck: (req) =>
    tryAsync(async () => {
      const row = await queryOne<{ id: number }>(
        'SELECT id FROM words WHERE surface = ? AND reading = ?',
        [req.surface, req.reading],
      );
      if (!row) return;
      // Cascade removes srs_state and reviews via FK.
      await run('DELETE FROM words WHERE id = ?', [row.id]);
      await appendSyncEvent('word.remove', {
        surface: req.surface,
        reading: req.reading,
      });
      syncEngine.notifyLocalChange();
    }),

  getDeckState: (req) =>
    tryAsync(async () => {
      const row = await queryOne<{
        word_id: number;
        surface: string;
        reading: string;
        state: string;
        due_date: string | null;
        review_count: number;
        lapse_count: number;
        last_reviewed_at: string | null;
        jlpt_level: number | null;
        first_sentence: string | null;
      }>(
        `SELECT s.word_id, w.surface, w.reading, s.state, s.due_date,
                s.review_count, s.lapse_count, s.last_reviewed_at,
                w.jlpt_level, w.first_sentence
           FROM srs_state s JOIN words w ON w.id = s.word_id
          WHERE w.surface = ? AND w.reading = ?`,
        [req.surface, req.reading],
      );
      return row ? rowToDeckEntry(row) : null;
    }),

  getDeckStatesBatch: (req) =>
    tryAsync(async () => {
      if (req.keys.length === 0) return {};
      const keysJson = JSON.stringify(req.keys.map((k) => [k.surface, k.reading]));
      const rows = await query<{
        word_id: number;
        surface: string;
        reading: string;
        state: string;
        due_date: string | null;
        review_count: number;
        lapse_count: number;
        last_reviewed_at: string | null;
        jlpt_level: number | null;
        first_sentence: string | null;
      }>(
        `WITH keys(surface, reading) AS (
           SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]')
             FROM json_each(?)
         )
         SELECT s.word_id, w.surface, w.reading, s.state, s.due_date,
                s.review_count, s.lapse_count, s.last_reviewed_at,
                w.jlpt_level, w.first_sentence
           FROM srs_state s
           JOIN words w ON w.id = s.word_id
           JOIN keys k ON k.surface = w.surface AND k.reading = w.reading`,
        [keysJson],
      );
      const out: Record<string, DeckEntry> = {};
      for (const row of rows) {
        out[`${row.surface}|${row.reading}`] = rowToDeckEntry(row);
      }
      return out;
    }),

  // review ------------------------------------------------------------------
  getReviewQueue: () =>
    tryAsync(async () => {
      const now = new Date().toISOString();
      const rows = await query<{
        word_id: number;
        surface: string;
        reading: string;
        pos: string;
        jlpt_level: number | null;
        meanings_json: string;
        first_sentence: string | null;
        state: string;
        due_date: string | null;
        review_count: number;
      }>(
        `SELECT s.word_id, s.state, s.due_date, s.review_count,
                w.surface, w.reading, w.pos, w.jlpt_level,
                w.meanings_json, w.first_sentence
           FROM srs_state s JOIN words w ON w.id = s.word_id
          WHERE s.state != 'known'
            AND (s.due_date IS NULL OR s.due_date <= ?)
          ORDER BY s.due_date ASC, s.word_id ASC
          LIMIT 200`,
        [now],
      );
      return rows.map((r) => ({
        wordId: r.word_id,
        surface: r.surface,
        reading: r.reading,
        pos: r.pos,
        jlptLevel: r.jlpt_level,
        meanings: safeParseEntries(r.meanings_json),
        firstSentence: r.first_sentence,
        state: r.state,
        reviewCount: r.review_count,
      }));
    }),

  submitReview: (req) =>
    tryAsync(async () => {
      const current = await queryOne<SrsRow>(
        'SELECT * FROM srs_state WHERE word_id = ?',
        [req.wordId],
      );
      if (!current) throw new Error(`No SRS state for word ${req.wordId}`);
      const word = await queryOne<{ surface: string; reading: string }>(
        'SELECT surface, reading FROM words WHERE id = ?',
        [req.wordId],
      );
      const now = new Date();
      const result = applyRating(current, req.rating as FsrsRating, now);
      await runTransaction([
        {
          statement: `UPDATE srs_state SET state = ?, due_date = ?, stability = ?,
                       difficulty = ?, review_count = ?, lapse_count = ?, last_reviewed_at = ?
                      WHERE word_id = ?`,
          values: [
            result.state,
            result.due_date,
            result.stability,
            result.difficulty,
            result.review_count,
            result.lapse_count,
            result.last_reviewed_at,
            req.wordId,
          ],
        },
        {
          statement: `INSERT INTO reviews (word_id, reviewed_at, rating,
                       interval_before, interval_after, stability_before, stability_after)
                      VALUES (?, ?, ?, ?, ?, ?, ?)`,
          values: [
            req.wordId,
            now.toISOString(),
            req.rating,
            result.intervalBefore,
            result.intervalAfter,
            result.stabilityBefore,
            result.stabilityAfter,
          ],
        },
      ]);

      // Capture the resulting SRS state in the event so peers don't have to
      // re-run FSRS — see capacitor-replayer.ts → applyReviewSubmit.
      if (word) {
        await appendSyncEvent('review.submit', {
          word: { surface: word.surface, reading: word.reading },
          rating: req.rating,
          reviewedAt: now.toISOString(),
          result: {
            state: result.state,
            dueDate: result.due_date,
            stability: result.stability,
            difficulty: result.difficulty,
            reviewCount: result.review_count,
            lapseCount: result.lapse_count,
            intervalBefore: result.intervalBefore,
            intervalAfter: result.intervalAfter,
            stabilityBefore: result.stabilityBefore,
            stabilityAfter: result.stabilityAfter,
          },
        });
        syncEngine.notifyLocalChange();
      }

      return {
        wordId: req.wordId,
        newState: result.state,
        newDueDate: result.due_date,
        intervalAfterDays: result.intervalAfter,
      };
    }),

  getTodayReviewCount: (req) =>
    tryAsync(async () => {
      const row = await queryOne<{ n: number }>(
        'SELECT COUNT(*) AS n FROM reviews WHERE reviewed_at >= ?',
        [req.sinceIso],
      );
      return { count: row?.n ?? 0 };
    }),

  // words list --------------------------------------------------------------
  listWords: (filter: WordListFilter) =>
    tryAsync(async () => {
      const where: string[] = ['1=1'];
      const params: unknown[] = [];

      if (filter.states && filter.states.length > 0) {
        const placeholders = filter.states.map(() => '?').join(',');
        where.push(`s.state IN (${placeholders})`);
        params.push(...filter.states);
      }
      if (filter.jlptLevels && filter.jlptLevels.length > 0) {
        const placeholders = filter.jlptLevels.map(() => '?').join(',');
        where.push(`w.jlpt_level IN (${placeholders})`);
        params.push(...filter.jlptLevels);
      }
      const search = filter.search?.trim();
      if (search) {
        where.push('(w.surface LIKE ? OR w.reading LIKE ?)');
        params.push(`%${search}%`, `%${search}%`);
      }

      const rows = await query<{
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
        seen_count: number | null;
      }>(
        `SELECT w.id, w.surface, w.reading, w.jlpt_level, w.pos,
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
          LIMIT 1000`,
        params,
      );

      const out: WordListItem[] = rows.map((r) => ({
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
      return out;
    }),

  bulkDeleteWords: (req) =>
    tryAsync(async () => {
      if (req.ids.length === 0) return { count: 0 };
      const keys = await collectKeys(req.ids);
      const placeholders = req.ids.map(() => '?').join(',');
      const result = await run(
        `DELETE FROM words WHERE id IN (${placeholders})`,
        req.ids,
      );
      if (keys.length > 0) {
        await appendSyncEvent('words.bulk-delete', { keys });
        syncEngine.notifyLocalChange();
      }
      return { count: result.changes };
    }),

  bulkMarkWordsKnown: (req) =>
    tryAsync(async () => {
      if (req.ids.length === 0) return { count: 0 };
      const keys = await collectKeys(req.ids);
      const placeholders = req.ids.map(() => '?').join(',');
      const result = await run(
        `UPDATE srs_state
            SET state = 'known', due_date = '${KNOWN_DUE}', stability = 365, difficulty = 1
          WHERE word_id IN (${placeholders})`,
        req.ids,
      );
      if (keys.length > 0) {
        await appendSyncEvent('words.bulk-mark-known', { keys });
        syncEngine.notifyLocalChange();
      }
      return { count: result.changes };
    }),

  // auto-updater (no-op on iOS; App Store / TestFlight handles updates) ----
  getUpdateStatus: async () => ok({ kind: 'idle' } as const),
  installUpdate: async () => err('Updates are managed by iOS — not applicable here.'),
  onUpdateStatus: () => noopUnsub,

  // sync --------------------------------------------------------------------
  getSyncInfo: () =>
    tryAsync(async () => {
      const id = await getDeviceId();
      const peers = await syncEngine.peers();
      const pendingPushCount = await syncEngine.pendingPushCount();
      return {
        deviceId: id,
        folder: syncEngine.resolvedFolder() ?? '(iCloud container — not yet resolved)',
        status: syncEngine.status(),
        peers,
        pendingPushCount,
      };
    }),

  runSync: () =>
    tryAsync(async () => {
      await syncEngine.run();
    }),

  setSyncFolder: async () =>
    err(
      "Sync folder is fixed to the app's iCloud container on iOS — change it on the Mac side instead.",
    ),

  resetSync: () =>
    tryAsync(async () => {
      // Clear peer cursors so the next pull re-ingests from the start. The
      // event-id dedupe in sync_events makes this safe — duplicates are
      // skipped without re-applying.
      await run(`UPDATE sync_peers SET last_event_id = ''`);
      await syncEngine.run();
    }),

  backfillSync: async () =>
    err(
      'Backfill is a Mac-only operation — run it on your computer to push your existing deck to the iPhone.',
    ),

  onSyncStatus: (cb) => syncEngine.onStatusChange(cb),
};

async function collectKeys(
  ids: number[],
): Promise<Array<{ surface: string; reading: string }>> {
  const out: Array<{ surface: string; reading: string }> = [];
  for (const id of ids) {
    const row = await queryOne<{ surface: string; reading: string }>(
      'SELECT surface, reading FROM words WHERE id = ?',
      [id],
    );
    if (row) out.push({ surface: row.surface, reading: row.reading });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Helpers used above

const TITLE_LEN = 30;
function makeTitle(rawText: string): string {
  const trimmed = rawText.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= TITLE_LEN) return trimmed;
  return trimmed.slice(0, TITLE_LEN) + '…';
}

function collectExamples(
  meanings: JmdictEntry[],
): Array<{ japanese: string; translation?: string }> {
  const examples: Array<{ japanese: string; translation?: string }> = [];
  for (const entry of meanings) {
    for (const sense of entry.senses) {
      if (!sense.examples) continue;
      for (const ex of sense.examples) {
        examples.push({
          japanese: ex.japanese,
          ...(ex.translations[0] ? { translation: ex.translations[0] } : {}),
        });
      }
    }
  }
  return examples;
}

// Ensures the DB connection is opened on first import. Renderer calls into
// this module via `api.*` and the first call already triggers `db()`, but we
// kick it off eagerly so migrations run during the initial render frame.
void db().catch((e) => {
   
  console.error('[capacitor-db] open failed', e);
});

// Same eager kickoff for kuromoji — runs in parallel with DB init so the
// warmup spinner clears as quickly as possible.
void ensureTokenizer();

// Defer engine.start() until the DB is ready so deviceId() resolves on
// first run. The engine itself is constructed earlier in the file.
void db().then(() => {
  syncEngine.start();
});
