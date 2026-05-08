import type {
  SyncEvent,
  WordAddPayload,
  WordRemovePayload,
  ReviewSubmitPayload,
  SessionSavePayload,
  SessionDeletePayload,
  BulkWordsPayload,
  SettingsSetPayload,
} from '@shared/types/sync';
import { SYNCED_SETTING_KEYS } from '@shared/types/sync';
import { query, queryOne, run } from './capacitor-db';
import { withReplaying } from './capacitor-event-log';

/**
 * Apply a remote sync event to the local iOS DB. Counterpart to
 * src/main/services/sync/event-replay.ts on Mac.
 *
 * Uses natural keys (surface+reading, raw_text) throughout because
 * auto-increment ids differ across devices. Wrapped in withReplaying so
 * any append() called transitively is suppressed — peers' events should
 * NOT be re-published from this device.
 */
export async function applyEvent(event: SyncEvent): Promise<void> {
  await withReplaying(async () => {
    switch (event.kind) {
      case 'word.add':
        await applyWordAdd(event.payload as WordAddPayload);
        return;
      case 'word.remove':
        await applyWordRemove(event.payload as WordRemovePayload);
        return;
      case 'review.submit':
        await applyReviewSubmit(event.payload as ReviewSubmitPayload);
        return;
      case 'session.save':
        await applySessionSave(event.payload as SessionSavePayload);
        return;
      case 'session.delete':
        await applySessionDelete(event.payload as SessionDeletePayload);
        return;
      case 'words.bulk-mark-known':
        await applyBulkMarkKnown(event.payload as BulkWordsPayload);
        return;
      case 'words.bulk-delete':
        await applyBulkDelete(event.payload as BulkWordsPayload);
        return;
      case 'settings.set':
        await applySettingsSet(event.payload as SettingsSetPayload);
        return;
      default: {
        const _exhaustive: never = event.kind;
        throw new Error(`Unknown sync event kind: ${String(_exhaustive)}`);
      }
    }
  });
}

const KNOWN_DUE = '9999-12-31';
const NEW_FIRST_REVIEW_DELAY_MS = 4 * 60 * 60 * 1000;

async function applyWordAdd(p: WordAddPayload): Promise<void> {
  const sessionId = p.firstSessionRawText
    ? await findSessionIdByText(p.firstSessionRawText)
    : null;
  const meaningsJson = JSON.stringify(p.meanings);
  const examples = collectExamples(p.meanings);
  const examplesJson = examples.length > 0 ? JSON.stringify(examples) : null;

  const existing = await queryOne<{ id: number }>(
    'SELECT id FROM words WHERE surface = ? AND reading = ?',
    [p.surface, p.reading],
  );

  let wordId: number;
  if (existing) {
    await run(
      `UPDATE words SET jlpt_level = ?, pos = ?, meanings_json = ?, example_sentences_json = ?
        WHERE id = ?`,
      [p.jlptLevel, p.pos, meaningsJson, examplesJson, existing.id],
    );
    wordId = existing.id;
  } else {
    const result = await run(
      `INSERT INTO words (
         surface, reading, jlpt_level, pos, meanings_json,
         example_sentences_json, first_session_id, first_sentence
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        p.surface,
        p.reading,
        p.jlptLevel,
        p.pos,
        meaningsJson,
        examplesJson,
        sessionId,
        p.firstSentence,
      ],
    );
    wordId = result.lastId;
  }

  const srsExists = await queryOne<{
    word_id: number;
    last_reviewed_at: string | null;
  }>(
    'SELECT word_id, last_reviewed_at FROM srs_state WHERE word_id = ?',
    [wordId],
  );
  if (!srsExists) {
    if (p.asKnown) {
      await run(
        `INSERT INTO srs_state (word_id, state, due_date, stability, difficulty)
         VALUES (?, 'known', ?, 365, 1)`,
        [wordId, KNOWN_DUE],
      );
    } else {
      const dueAt = new Date(Date.now() + NEW_FIRST_REVIEW_DELAY_MS).toISOString();
      await run(
        `INSERT INTO srs_state (word_id, state, due_date, stability, difficulty)
         VALUES (?, 'new', ?, 0, 0)`,
        [wordId, dueAt],
      );
    }
  }

  // Backfill snapshot — only stomp on local SRS state if the local row
  // hasn't been reviewed more recently than the snapshot says.
  if (p.srsSnapshot) {
    const snap = p.srsSnapshot;
    const localLast = srsExists?.last_reviewed_at;
    const newerLocal =
      localLast && snap.lastReviewedAt && localLast > snap.lastReviewedAt;
    if (!newerLocal) {
      await run(
        `UPDATE srs_state SET state = ?, due_date = ?, stability = ?,
           difficulty = ?, review_count = ?, lapse_count = ?, last_reviewed_at = ?
         WHERE word_id = ?`,
        [
          snap.state,
          snap.dueDate,
          snap.stability,
          snap.difficulty,
          snap.reviewCount,
          snap.lapseCount,
          snap.lastReviewedAt,
          wordId,
        ],
      );
    }
  }
}

async function applyWordRemove(p: WordRemovePayload): Promise<void> {
  const row = await queryOne<{ id: number }>(
    'SELECT id FROM words WHERE surface = ? AND reading = ?',
    [p.surface, p.reading],
  );
  if (!row) return;
  await run('DELETE FROM words WHERE id = ?', [row.id]);
}

async function applyReviewSubmit(p: ReviewSubmitPayload): Promise<void> {
  const word = await queryOne<{ id: number }>(
    'SELECT id FROM words WHERE surface = ? AND reading = ?',
    [p.word.surface, p.word.reading],
  );
  if (!word) return; // word not yet replicated; next pull will retry

  // Last-write-wins on SRS state by reviewedAt — older replays only append
  // to the review log without clobbering newer state.
  const current = await queryOne<{ last_reviewed_at: string | null }>(
    'SELECT last_reviewed_at FROM srs_state WHERE word_id = ?',
    [word.id],
  );
  const currentLast = current?.last_reviewed_at;
  if (!currentLast || p.reviewedAt > currentLast) {
    await run(
      `UPDATE srs_state SET state = ?, due_date = ?, stability = ?,
        difficulty = ?, review_count = ?, lapse_count = ?, last_reviewed_at = ?
        WHERE word_id = ?`,
      [
        p.result.state,
        p.result.dueDate,
        p.result.stability,
        p.result.difficulty,
        p.result.reviewCount,
        p.result.lapseCount,
        p.reviewedAt,
        word.id,
      ],
    );
  }
  await run(
    `INSERT INTO reviews (word_id, reviewed_at, rating,
       interval_before, interval_after, stability_before, stability_after)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      word.id,
      p.reviewedAt,
      p.rating,
      p.result.intervalBefore,
      p.result.intervalAfter,
      p.result.stabilityBefore,
      p.result.stabilityAfter,
    ],
  );
}

async function applySessionSave(p: SessionSavePayload): Promise<void> {
  const tokensJson = JSON.stringify(p.tokens);
  const existing = await queryOne<{ id: number }>(
    'SELECT id FROM sessions WHERE raw_text = ? ORDER BY id DESC LIMIT 1',
    [p.rawText],
  );
  if (existing) {
    await run('UPDATE sessions SET processed_tokens_json = ? WHERE id = ?', [
      tokensJson,
      existing.id,
    ]);
    return;
  }
  const title = makeTitle(p.rawText);
  await run(
    `INSERT INTO sessions (title, raw_text, processed_tokens_json)
     VALUES (?, ?, ?)`,
    [title, p.rawText, tokensJson],
  );
}

async function applySessionDelete(p: SessionDeletePayload): Promise<void> {
  const id = await findSessionIdByText(p.rawText);
  if (id != null) await run('DELETE FROM sessions WHERE id = ?', [id]);
}

async function applyBulkMarkKnown(p: BulkWordsPayload): Promise<void> {
  const ids = await resolveWordIds(p.keys);
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  await run(
    `UPDATE srs_state
        SET state = 'known', due_date = '${KNOWN_DUE}', stability = 365, difficulty = 1
      WHERE word_id IN (${placeholders})`,
    ids,
  );
}

async function applyBulkDelete(p: BulkWordsPayload): Promise<void> {
  const ids = await resolveWordIds(p.keys);
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  await run(`DELETE FROM words WHERE id IN (${placeholders})`, ids);
}

async function applySettingsSet(p: SettingsSetPayload): Promise<void> {
  if (!SYNCED_SETTING_KEYS.has(p.key)) return;
  await run(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [p.key, p.value],
  );
}

// ---------------------------------------------------------------------------
// helpers

async function findSessionIdByText(rawText: string): Promise<number | null> {
  const row = await queryOne<{ id: number }>(
    'SELECT id FROM sessions WHERE raw_text = ? ORDER BY id DESC LIMIT 1',
    [rawText],
  );
  return row?.id ?? null;
}

async function resolveWordIds(
  keys: BulkWordsPayload['keys'],
): Promise<number[]> {
  const ids: number[] = [];
  for (const k of keys) {
    const row = await queryOne<{ id: number }>(
      'SELECT id FROM words WHERE surface = ? AND reading = ?',
      [k.surface, k.reading],
    );
    if (row) ids.push(row.id);
  }
  return ids;
}

function makeTitle(rawText: string): string {
  const trimmed = rawText.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= 30) return trimmed;
  return trimmed.slice(0, 30) + '…';
}

interface JmdictEntryShape {
  senses: Array<{
    examples?: Array<{ japanese: string; translations: string[] }>;
  }>;
}

function collectExamples(
  meanings: JmdictEntryShape[],
): Array<{ japanese: string; translation?: string }> {
  const out: Array<{ japanese: string; translation?: string }> = [];
  for (const entry of meanings) {
    for (const sense of entry.senses) {
      if (!sense.examples) continue;
      for (const ex of sense.examples) {
        const first = ex.translations[0];
        out.push(
          first ? { japanese: ex.japanese, translation: first } : { japanese: ex.japanese },
        );
      }
    }
  }
  return out;
}

// query() is unused but kept here to keep imports symmetrical with the
// helpers above; unused-import linter accepts it.
void query;

// Marker to silence unused import warning if applyEvent is the only export.
export const __replayerVersion = 1;
