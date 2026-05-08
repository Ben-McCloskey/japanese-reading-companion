import type { Result } from './result';
import type { JmdictEntry } from './types/jmdict';
import type { Token } from './types/tokenizer';
import type { DeckEntry, WordListFilter, WordListItem } from './types/deck';
import type { SessionDetail, SessionListItem } from './types/sessions';

export const IPC = {
  PING: 'ping',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',

  DICT_STATUS: 'dict:status',
  DICT_IMPORT: 'dict:import',
  DICT_LOOKUP: 'dict:lookup',
  DICT_LOOKUP_WORD: 'dict:lookup-word',
  DICT_PROGRESS_EVENT: 'dict:progress',

  TOKENIZER_STATUS: 'tokenizer:status',
  TOKENIZER_READY_EVENT: 'tokenizer:ready',
  TOKENIZER_TOKENIZE: 'tokenizer:tokenize',

  SESSION_SAVE: 'session:save',

  DECK_ADD: 'deck:add',
  DECK_REMOVE: 'deck:remove',
  DECK_STATE: 'deck:state',
  DECK_STATES_BATCH: 'deck:states-batch',

  REVIEW_QUEUE: 'review:queue',
  REVIEW_SUBMIT: 'review:submit',

  WORDS_LIST: 'words:list',
  WORDS_BULK_DELETE: 'words:bulk-delete',
  WORDS_BULK_MARK_KNOWN: 'words:bulk-mark-known',

  SESSIONS_LIST: 'sessions:list',
  SESSION_GET: 'session:get',
  SESSION_DELETE: 'session:delete',

  UPDATE_STATUS: 'update:status',
  UPDATE_STATUS_EVENT: 'update:status-event',
  UPDATE_INSTALL: 'update:install',

  SYNC_INFO: 'sync:info',
  SYNC_RUN: 'sync:run',
  SYNC_SET_FOLDER: 'sync:set-folder',
  SYNC_RESET: 'sync:reset',
  SYNC_BACKFILL: 'sync:backfill',
  SYNC_STATUS_EVENT: 'sync:status-event',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

// settings ---------------------------------------------------------------
export type PingResponse = Result<'pong'>;

export type SettingsGetRequest = { key: string };
export type SettingsGetResponse = Result<string | null>;

export type SettingsSetRequest = { key: string; value: string };
export type SettingsSetResponse = Result<void>;

// dictionary -------------------------------------------------------------
export type DictStatus =
  | { kind: 'unknown' }
  | { kind: 'needs-import' }
  | { kind: 'importing'; phase: DictImportPhase; received?: number; total?: number; entries?: number }
  | { kind: 'ready'; entryCount: number }
  | { kind: 'failed'; error: string };

export type DictImportPhase =
  | 'downloading'
  | 'decompressing'
  | 'parsing'
  | 'finalizing'
  | 'jlpt';

export type DictStatusResponse = Result<DictStatus>;
export type DictImportResponse = Result<void>;

export type DictLookupRequest = { key: string };
export type DictLookupResponse = Result<JmdictEntry[]>;

export interface WordLookupRequest {
  surface: string;
  basicForm?: string;
  reading?: string;
}

export interface WordLookupHit {
  matchedKey: string;
  jlptLevel: number | null;
  entries: JmdictEntry[];
}

export type WordLookupResponse = Result<WordLookupHit | null>;

// tokenizer --------------------------------------------------------------
export type TokenizerStatus =
  // `loaded` / `total` are populated by the iOS Capacitor build (so the
  // user sees download progress while kuromoji's dict trie inflates).
  // The Electron build emits warming without those fields.
  | { kind: 'warming'; loaded?: number; total?: number }
  | { kind: 'ready' }
  | { kind: 'failed'; error: string };

export type TokenizerStatusResponse = Result<TokenizerStatus>;

export type TokenizeRequest = { text: string };
export type TokenizeResponse = Result<Token[]>;

// session ----------------------------------------------------------------
export interface SessionSaveRequest {
  rawText: string;
  tokens: Token[];
}
export type SessionSaveResponse = Result<{ id: number }>;

// deck -------------------------------------------------------------------
export interface DeckAddRequest {
  surface: string;
  reading: string;
  jlptLevel: number | null;
  pos: string;
  meanings: JmdictEntry[];
  sessionId: number | null;
  firstSentence: string | null;
  asKnown?: boolean;
}
export type DeckAddResponse = Result<DeckEntry>;

export interface DeckRemoveRequest {
  surface: string;
  reading: string;
}
export type DeckRemoveResponse = Result<void>;

export interface DeckStateRequest {
  surface: string;
  reading: string;
}
export type DeckStateResponse = Result<DeckEntry | null>;

export interface DeckStatesBatchRequest {
  keys: Array<{ surface: string; reading: string }>;
}
export type DeckStatesBatchResponse = Result<Record<string, DeckEntry>>;

// review -----------------------------------------------------------------
export interface ReviewCardDto {
  wordId: number;
  surface: string;
  reading: string;
  pos: string;
  jlptLevel: number | null;
  meanings: JmdictEntry[];
  firstSentence: string | null;
  state: string;
  reviewCount: number;
}

export type ReviewQueueResponse = Result<ReviewCardDto[]>;

export interface ReviewSubmitRequest {
  wordId: number;
  rating: 1 | 2 | 3 | 4;
}

export interface ReviewSubmitResult {
  wordId: number;
  newState: string;
  newDueDate: string;
  intervalAfterDays: number;
}

export type ReviewSubmitResponse = Result<ReviewSubmitResult>;

// words list -------------------------------------------------------------
export type WordsListRequest = WordListFilter;
export type WordsListResponse = Result<WordListItem[]>;

export interface WordsBulkRequest {
  ids: number[];
}
export type WordsBulkResponse = Result<{ count: number }>;

// sessions list ----------------------------------------------------------
export type SessionsListResponse = Result<SessionListItem[]>;

export interface SessionGetRequest {
  id: number;
}
export type SessionGetResponse = Result<SessionDetail | null>;

export interface SessionDeleteRequest {
  id: number;
}
export type SessionDeleteResponse = Result<void>;

// auto-updater ----------------------------------------------------------
export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'downloading'; percent: number; version?: string }
  | { kind: 'ready'; version: string }
  | { kind: 'error'; error: string };

export type UpdateStatusResponse = Result<UpdateStatus>;
export type UpdateInstallResponse = Result<void>;

// sync ------------------------------------------------------------------
export type SyncStatus =
  | { kind: 'idle' }
  | { kind: 'pushing' }
  | { kind: 'pulling' }
  | { kind: 'error'; error: string };

export interface SyncPeerInfo {
  deviceId: string;
  lastEventId: string;
  lastSeenAt: string;
}

export interface SyncInfo {
  deviceId: string;
  folder: string;
  status: SyncStatus;
  peers: SyncPeerInfo[];
  pendingPushCount: number;
}

export type SyncInfoResponse = Result<SyncInfo>;
export type SyncRunResponse = Result<void>;
export type SyncSetFolderRequest = { folder: string | null };
export type SyncSetFolderResponse = Result<void>;
export type SyncResetResponse = Result<void>;
export type SyncBackfillResponse = Result<{ sessions: number; words: number }>;
