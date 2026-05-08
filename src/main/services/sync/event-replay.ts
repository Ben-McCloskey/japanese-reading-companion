import type { Database } from 'better-sqlite3';
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
import type { SettingsRepo } from '@main/db/repos/settings-repo';
import type { WordsRepo } from '@main/db/repos/words-repo';
import type { SessionsRepo } from '@main/db/repos/sessions-repo';
import type { SrsRepo } from '@main/db/repos/srs-repo';
import type { ReviewsRepo } from '@main/db/repos/reviews-repo';
import type { DeckService } from '@main/services/deck';
import type { AppearancesService } from '@main/services/appearances';

interface ReplayDeps {
  db: Database;
  settings: SettingsRepo;
  words: WordsRepo;
  sessions: SessionsRepo;
  srs: SrsRepo;
  reviews: ReviewsRepo;
  deck: DeckService;
  appearances: AppearancesService;
}

export interface EventReplayer {
  apply(event: SyncEvent): void;
}

/**
 * Apply a remote sync event to the local DB, bypassing the local event log so
 * the replay doesn't echo back to peers. Uses natural keys throughout
 * (surface+reading for words, raw_text for sessions) since auto-increment ids
 * differ across devices.
 */
export function createEventReplayer(deps: ReplayDeps): EventReplayer {
  function applyWordAdd(payload: WordAddPayload): void {
    const sessionId = payload.firstSessionRawText
      ? findSessionIdByText(payload.firstSessionRawText)
      : null;
    const entry = deps.deck.addWord({
      surface: payload.surface,
      reading: payload.reading,
      jlptLevel: payload.jlptLevel,
      pos: payload.pos,
      meanings: payload.meanings,
      firstSessionId: sessionId,
      firstSentence: payload.firstSentence,
      ...(payload.asKnown ? { asKnown: true } : {}),
    });
    // Backfill snapshot wins only if there's no newer activity locally.
    // We compare reviewedAt against the local row's last_reviewed_at the
    // same way review.submit does — last-write-wins by reviewedAt.
    if (payload.srsSnapshot) {
      const snap = payload.srsSnapshot;
      const local = deps.srs.getByWord(entry.wordId);
      const newerLocal =
        local?.last_reviewed_at &&
        snap.lastReviewedAt &&
        local.last_reviewed_at > snap.lastReviewedAt;
      if (!newerLocal) {
        deps.srs.applyPatchSync({
          wordId: entry.wordId,
          state: snap.state,
          dueDate: snap.dueDate ?? new Date().toISOString(),
          stability: snap.stability,
          difficulty: snap.difficulty,
          reviewCount: snap.reviewCount,
          lapseCount: snap.lapseCount,
          lastReviewedAt: snap.lastReviewedAt ?? new Date().toISOString(),
        });
      }
    }
  }

  function applyWordRemove(payload: WordRemovePayload): void {
    deps.deck.removeWord(payload.surface, payload.reading);
  }

  function applyReviewSubmit(payload: ReviewSubmitPayload): void {
    const word = deps.words.getByKey(payload.word.surface, payload.word.reading);
    if (!word) return; // word not yet replicated; the next pull will retry
    // Last-write-wins on SRS state by reviewedAt — older replays only append
    // to the review log without clobbering a newer state computed elsewhere.
    const current = deps.srs.getByWord(word.id);
    const currentLast = current?.last_reviewed_at;
    if (!currentLast || payload.reviewedAt > currentLast) {
      deps.srs.applyPatchSync({
        wordId: word.id,
        state: payload.result.state,
        dueDate: payload.result.dueDate,
        stability: payload.result.stability,
        difficulty: payload.result.difficulty,
        reviewCount: payload.result.reviewCount,
        lapseCount: payload.result.lapseCount,
        lastReviewedAt: payload.reviewedAt,
      });
    }
    deps.reviews.log({
      word_id: word.id,
      rating: payload.rating,
      interval_before: payload.result.intervalBefore,
      interval_after: payload.result.intervalAfter,
      stability_before: payload.result.stabilityBefore,
      stability_after: payload.result.stabilityAfter,
      reviewed_at: payload.reviewedAt,
    });
  }

  function applySessionSave(payload: SessionSavePayload): void {
    const id = deps.sessions.saveOrReuse({
      rawText: payload.rawText,
      processedTokensJson: JSON.stringify(payload.tokens),
    });
    deps.appearances.syncForSession(id, payload.tokens);
  }

  function applySessionDelete(payload: SessionDeletePayload): void {
    const id = findSessionIdByText(payload.rawText);
    if (id != null) deps.sessions.remove(id);
  }

  function applyBulkMarkKnown(payload: BulkWordsPayload): void {
    const ids = resolveWordIds(payload.keys);
    if (ids.length > 0) deps.words.bulkMarkKnown(ids);
  }

  function applyBulkDelete(payload: BulkWordsPayload): void {
    const ids = resolveWordIds(payload.keys);
    if (ids.length > 0) deps.words.bulkRemove(ids);
  }

  function applySettingsSet(payload: SettingsSetPayload): void {
    if (!SYNCED_SETTING_KEYS.has(payload.key)) return;
    deps.settings.set(payload.key, payload.value);
  }

  function findSessionIdByText(rawText: string): number | null {
    const row = deps.db
      .prepare<{ raw_text: string }, { id: number }>(
        'SELECT id FROM sessions WHERE raw_text = @raw_text ORDER BY id DESC LIMIT 1',
      )
      .get({ raw_text: rawText });
    return row?.id ?? null;
  }

  function resolveWordIds(keys: BulkWordsPayload['keys']): number[] {
    const ids: number[] = [];
    for (const k of keys) {
      const w = deps.words.getByKey(k.surface, k.reading);
      if (w) ids.push(w.id);
    }
    return ids;
  }

  return {
    apply(event: SyncEvent): void {
      const dispatch = deps.db.transaction(() => {
        switch (event.kind) {
          case 'word.add':
            applyWordAdd(event.payload as WordAddPayload);
            return;
          case 'word.remove':
            applyWordRemove(event.payload as WordRemovePayload);
            return;
          case 'review.submit':
            applyReviewSubmit(event.payload as ReviewSubmitPayload);
            return;
          case 'session.save':
            applySessionSave(event.payload as SessionSavePayload);
            return;
          case 'session.delete':
            applySessionDelete(event.payload as SessionDeletePayload);
            return;
          case 'words.bulk-mark-known':
            applyBulkMarkKnown(event.payload as BulkWordsPayload);
            return;
          case 'words.bulk-delete':
            applyBulkDelete(event.payload as BulkWordsPayload);
            return;
          case 'settings.set':
            applySettingsSet(event.payload as SettingsSetPayload);
            return;
          default: {
            const _exhaustive: never = event.kind;
            throw new Error(`Unknown sync event kind: ${String(_exhaustive)}`);
          }
        }
      });
      dispatch();
    },
  };
}
