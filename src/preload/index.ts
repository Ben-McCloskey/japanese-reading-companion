import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  IPC,
  type PingResponse,
  type SettingsGetResponse,
  type SettingsSetResponse,
  type DictStatus,
  type DictStatusResponse,
  type DictImportResponse,
  type DictLookupResponse,
  type WordLookupResponse,
  type SessionSaveResponse,
  type DeckAddResponse,
  type DeckRemoveResponse,
  type DeckStateResponse,
  type DeckStatesBatchResponse,
  type ReviewQueueResponse,
  type ReviewSubmitResponse,
  type WordsListResponse,
  type WordsBulkResponse,
  type SessionsListResponse,
  type SessionGetResponse,
  type SessionDeleteResponse,
  type UpdateStatus,
  type UpdateStatusResponse,
  type UpdateInstallResponse,
  type TokenizerStatus,
  type TokenizerStatusResponse,
  type TokenizeResponse,
} from '@shared/ipc';
import type { Api, Unsubscribe } from '@shared/api';

const api: Api = {
  ping: (): Promise<PingResponse> => ipcRenderer.invoke(IPC.PING),
  getSetting: (key): Promise<SettingsGetResponse> =>
    ipcRenderer.invoke(IPC.SETTINGS_GET, { key }),
  setSetting: (key, value): Promise<SettingsSetResponse> =>
    ipcRenderer.invoke(IPC.SETTINGS_SET, { key, value }),

  getDictStatus: (): Promise<DictStatusResponse> =>
    ipcRenderer.invoke(IPC.DICT_STATUS),
  importDict: (): Promise<DictImportResponse> =>
    ipcRenderer.invoke(IPC.DICT_IMPORT),
  lookupDict: (key): Promise<DictLookupResponse> =>
    ipcRenderer.invoke(IPC.DICT_LOOKUP, { key }),
  lookupWord: (req): Promise<WordLookupResponse> =>
    ipcRenderer.invoke(IPC.DICT_LOOKUP_WORD, req),
  onDictProgress: (cb: (s: DictStatus) => void): Unsubscribe => {
    const handler = (_e: IpcRendererEvent, status: DictStatus) => cb(status);
    ipcRenderer.on(IPC.DICT_PROGRESS_EVENT, handler);
    return () => ipcRenderer.off(IPC.DICT_PROGRESS_EVENT, handler);
  },

  getTokenizerStatus: (): Promise<TokenizerStatusResponse> =>
    ipcRenderer.invoke(IPC.TOKENIZER_STATUS),
  onTokenizerReady: (cb: (s: TokenizerStatus) => void): Unsubscribe => {
    const handler = (_e: IpcRendererEvent, status: TokenizerStatus) =>
      cb(status);
    ipcRenderer.on(IPC.TOKENIZER_READY_EVENT, handler);
    return () => ipcRenderer.off(IPC.TOKENIZER_READY_EVENT, handler);
  },
  tokenize: (text): Promise<TokenizeResponse> =>
    ipcRenderer.invoke(IPC.TOKENIZER_TOKENIZE, { text }),

  saveSession: (req): Promise<SessionSaveResponse> =>
    ipcRenderer.invoke(IPC.SESSION_SAVE, req),

  addToDeck: (req): Promise<DeckAddResponse> =>
    ipcRenderer.invoke(IPC.DECK_ADD, req),
  removeFromDeck: (req): Promise<DeckRemoveResponse> =>
    ipcRenderer.invoke(IPC.DECK_REMOVE, req),
  getDeckState: (req): Promise<DeckStateResponse> =>
    ipcRenderer.invoke(IPC.DECK_STATE, req),
  getDeckStatesBatch: (req): Promise<DeckStatesBatchResponse> =>
    ipcRenderer.invoke(IPC.DECK_STATES_BATCH, req),

  getReviewQueue: (): Promise<ReviewQueueResponse> =>
    ipcRenderer.invoke(IPC.REVIEW_QUEUE),
  submitReview: (req): Promise<ReviewSubmitResponse> =>
    ipcRenderer.invoke(IPC.REVIEW_SUBMIT, req),

  listWords: (req): Promise<WordsListResponse> =>
    ipcRenderer.invoke(IPC.WORDS_LIST, req),
  bulkDeleteWords: (req): Promise<WordsBulkResponse> =>
    ipcRenderer.invoke(IPC.WORDS_BULK_DELETE, req),
  bulkMarkWordsKnown: (req): Promise<WordsBulkResponse> =>
    ipcRenderer.invoke(IPC.WORDS_BULK_MARK_KNOWN, req),

  listSessions: (): Promise<SessionsListResponse> =>
    ipcRenderer.invoke(IPC.SESSIONS_LIST),
  getSession: (req): Promise<SessionGetResponse> =>
    ipcRenderer.invoke(IPC.SESSION_GET, req),
  deleteSession: (req): Promise<SessionDeleteResponse> =>
    ipcRenderer.invoke(IPC.SESSION_DELETE, req),

  getUpdateStatus: (): Promise<UpdateStatusResponse> =>
    ipcRenderer.invoke(IPC.UPDATE_STATUS),
  installUpdate: (): Promise<UpdateInstallResponse> =>
    ipcRenderer.invoke(IPC.UPDATE_INSTALL),
  onUpdateStatus: (cb: (status: UpdateStatus) => void): Unsubscribe => {
    const handler = (_e: IpcRendererEvent, status: UpdateStatus) => cb(status);
    ipcRenderer.on(IPC.UPDATE_STATUS_EVENT, handler);
    return () => ipcRenderer.off(IPC.UPDATE_STATUS_EVENT, handler);
  },
};

contextBridge.exposeInMainWorld('api', api);
