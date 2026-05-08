import type {
  PingResponse,
  SettingsGetResponse,
  SettingsSetResponse,
  DictStatus,
  DictStatusResponse,
  DictImportResponse,
  DictLookupResponse,
  WordLookupResponse,
  WordLookupRequest,
  TokenizerStatus,
  TokenizerStatusResponse,
  TokenizeResponse,
  SessionSaveRequest,
  SessionSaveResponse,
  DeckAddRequest,
  DeckAddResponse,
  DeckRemoveRequest,
  DeckRemoveResponse,
  DeckStateRequest,
  DeckStateResponse,
  DeckStatesBatchRequest,
  DeckStatesBatchResponse,
  ReviewQueueResponse,
  ReviewSubmitRequest,
  ReviewSubmitResponse,
  WordsListRequest,
  WordsListResponse,
  WordsBulkRequest,
  WordsBulkResponse,
  SessionsListResponse,
  SessionGetRequest,
  SessionGetResponse,
  SessionDeleteRequest,
  SessionDeleteResponse,
  UpdateStatus,
  UpdateStatusResponse,
  UpdateInstallResponse,
  SyncStatus,
  SyncInfoResponse,
  SyncRunResponse,
  SyncSetFolderRequest,
  SyncSetFolderResponse,
  SyncResetResponse,
  SyncBackfillResponse,
} from './ipc';

export type Unsubscribe = () => void;

export interface Api {
  ping(): Promise<PingResponse>;
  getSetting(key: string): Promise<SettingsGetResponse>;
  setSetting(key: string, value: string): Promise<SettingsSetResponse>;

  // dictionary
  getDictStatus(): Promise<DictStatusResponse>;
  importDict(): Promise<DictImportResponse>;
  lookupDict(key: string): Promise<DictLookupResponse>;
  lookupWord(req: WordLookupRequest): Promise<WordLookupResponse>;
  onDictProgress(cb: (status: DictStatus) => void): Unsubscribe;

  // tokenizer
  getTokenizerStatus(): Promise<TokenizerStatusResponse>;
  onTokenizerReady(cb: (status: TokenizerStatus) => void): Unsubscribe;
  tokenize(text: string): Promise<TokenizeResponse>;

  // sessions
  saveSession(req: SessionSaveRequest): Promise<SessionSaveResponse>;

  // deck
  addToDeck(req: DeckAddRequest): Promise<DeckAddResponse>;
  removeFromDeck(req: DeckRemoveRequest): Promise<DeckRemoveResponse>;
  getDeckState(req: DeckStateRequest): Promise<DeckStateResponse>;
  getDeckStatesBatch(req: DeckStatesBatchRequest): Promise<DeckStatesBatchResponse>;

  // review
  getReviewQueue(): Promise<ReviewQueueResponse>;
  submitReview(req: ReviewSubmitRequest): Promise<ReviewSubmitResponse>;

  // words list
  listWords(req: WordsListRequest): Promise<WordsListResponse>;
  bulkDeleteWords(req: WordsBulkRequest): Promise<WordsBulkResponse>;
  bulkMarkWordsKnown(req: WordsBulkRequest): Promise<WordsBulkResponse>;

  // sessions
  listSessions(): Promise<SessionsListResponse>;
  getSession(req: SessionGetRequest): Promise<SessionGetResponse>;
  deleteSession(req: SessionDeleteRequest): Promise<SessionDeleteResponse>;

  // auto-updater
  getUpdateStatus(): Promise<UpdateStatusResponse>;
  installUpdate(): Promise<UpdateInstallResponse>;
  onUpdateStatus(cb: (status: UpdateStatus) => void): Unsubscribe;

  // sync
  getSyncInfo(): Promise<SyncInfoResponse>;
  runSync(): Promise<SyncRunResponse>;
  setSyncFolder(req: SyncSetFolderRequest): Promise<SyncSetFolderResponse>;
  resetSync(): Promise<SyncResetResponse>;
  backfillSync(): Promise<SyncBackfillResponse>;
  onSyncStatus(cb: (status: SyncStatus) => void): Unsubscribe;
}
