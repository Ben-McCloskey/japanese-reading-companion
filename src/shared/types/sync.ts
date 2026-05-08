import type { JmdictEntry } from './jmdict';
import type { SrsState } from './deck';
import type { Token } from './tokenizer';

export interface WordKey {
  surface: string;
  reading: string;
}

export type SyncEventKind =
  | 'word.add'
  | 'word.remove'
  | 'review.submit'
  | 'session.save'
  | 'session.delete'
  | 'words.bulk-mark-known'
  | 'words.bulk-delete'
  | 'settings.set';

export interface WordAddPayload {
  surface: string;
  reading: string;
  jlptLevel: number | null;
  pos: string;
  meanings: JmdictEntry[];
  firstSentence: string | null;
  // Resolve session by raw_text (ids differ across devices). Optional —
  // null when the word was added outside any session context.
  firstSessionRawText: string | null;
  asKnown: boolean;
  // Optional initial SRS state for the word. When present the replayer
  // applies this state instead of the default 'new' bootstrap. Used by the
  // one-shot backfill on Mac so existing-deck words arrive on iOS already
  // at their current review state.
  srsSnapshot?: {
    state: SrsState;
    dueDate: string | null;
    stability: number;
    difficulty: number;
    reviewCount: number;
    lapseCount: number;
    lastReviewedAt: string | null;
  };
}

export interface WordRemovePayload extends WordKey {}

export interface ReviewSubmitPayload {
  word: WordKey;
  rating: 1 | 2 | 3 | 4;
  reviewedAt: string;
  // The resulting SRS state is captured here so replay doesn't have to
  // re-run FSRS (which can diverge across devices that haven't fully
  // converged yet). Last-write-wins by reviewedAt at the SRS state level.
  result: {
    state: SrsState;
    dueDate: string;
    stability: number;
    difficulty: number;
    reviewCount: number;
    lapseCount: number;
    intervalBefore: number | null;
    intervalAfter: number;
    stabilityBefore: number;
    stabilityAfter: number;
  };
}

export interface SessionSavePayload {
  rawText: string;
  tokens: Token[];
  createdAt: string;
}

export interface SessionDeletePayload {
  rawText: string;
}

export interface BulkWordsPayload {
  keys: WordKey[];
}

export interface SettingsSetPayload {
  key: string;
  value: string;
}

export type SyncEventPayloadOf<K extends SyncEventKind> =
  K extends 'word.add' ? WordAddPayload :
  K extends 'word.remove' ? WordRemovePayload :
  K extends 'review.submit' ? ReviewSubmitPayload :
  K extends 'session.save' ? SessionSavePayload :
  K extends 'session.delete' ? SessionDeletePayload :
  K extends 'words.bulk-mark-known' ? BulkWordsPayload :
  K extends 'words.bulk-delete' ? BulkWordsPayload :
  K extends 'settings.set' ? SettingsSetPayload :
  never;

export interface SyncEvent<K extends SyncEventKind = SyncEventKind> {
  id: string;
  deviceId: string;
  ts: string;
  kind: K;
  payload: SyncEventPayloadOf<K>;
}

/**
 * Settings keys whose changes are replicated. Other keys (deviceId,
 * reviewsDoneDate, reviewsDoneCount) stay device-local.
 */
export const SYNCED_SETTING_KEYS = new Set<string>([
  'theme',
  'ttsVoice',
  'dailyReviewCap',
]);
