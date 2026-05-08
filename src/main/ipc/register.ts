import { ipcMain } from 'electron';
import {
  IPC,
  type SettingsGetRequest,
  type SettingsGetResponse,
  type SettingsSetRequest,
  type SettingsSetResponse,
  type PingResponse,
  type DictStatusResponse,
  type DictImportResponse,
  type DictLookupRequest,
  type DictLookupResponse,
  type WordLookupRequest,
  type WordLookupResponse,
  type DictStatus,
  type TokenizerStatusResponse,
  type TokenizeRequest,
  type TokenizeResponse,
  type TokenizerStatus,
  type SessionSaveRequest,
  type SessionSaveResponse,
  type DeckAddRequest,
  type DeckAddResponse,
  type DeckRemoveRequest,
  type DeckRemoveResponse,
  type DeckStateRequest,
  type DeckStateResponse,
  type DeckStatesBatchRequest,
  type DeckStatesBatchResponse,
  type ReviewQueueResponse,
  type ReviewSubmitRequest,
  type ReviewSubmitResponse,
  type WordsListRequest,
  type WordsListResponse,
  type WordsBulkRequest,
  type WordsBulkResponse,
  type SessionsListResponse,
  type SessionGetRequest,
  type SessionGetResponse,
  type SessionDeleteRequest,
  type SessionDeleteResponse,
  type UpdateStatus,
  type UpdateStatusResponse,
  type UpdateInstallResponse,
  type SyncInfoResponse,
  type SyncRunResponse,
  type SyncSetFolderRequest,
  type SyncSetFolderResponse,
  type SyncResetResponse,
  type SyncBackfillResponse,
} from '@shared/ipc';
import type { Token } from '@shared/types/tokenizer';
import { ok, err } from '@shared/result';
import type { SettingsRepo } from '@main/db/repos/settings-repo';
import type { JmdictRepo } from '@main/db/repos/jmdict-repo';
import type { JlptRepo } from '@main/db/repos/jlpt-repo';
import type { SessionsRepo } from '@main/db/repos/sessions-repo';
import type { WordsRepo } from '@main/db/repos/words-repo';
import type { AppearancesService } from '@main/services/appearances';
import { quitAndInstall } from '@main/services/auto-updater';
import type { DeckService } from '@main/services/deck';
import type { ReviewService } from '@main/services/review';
import type { TokenizerService } from '@main/services/tokenizer';
import type { EventLog } from '@main/services/sync/event-log';
import type { SyncEngine } from '@main/services/sync/engine';
import type { SyncEventsRepo } from '@main/db/repos/sync-events-repo';
import type { SrsRepo } from '@main/db/repos/srs-repo';
import { runBackfill } from '@main/services/sync/backfill';
import { SYNCED_SETTING_KEYS } from '@shared/types/sync';
import { importJmdict } from '@main/services/dictionary/importer';
import { importJlpt } from '@main/services/dictionary/jlpt-importer';
import { lookupWord } from '@main/services/dictionary/lookup';
import { broadcast } from './events';

function safeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function collectWordKeys(
  words: WordsRepo,
  ids: number[],
): Array<{ surface: string; reading: string }> {
  const keys: Array<{ surface: string; reading: string }> = [];
  for (const id of ids) {
    const row = words.getById(id);
    if (row) keys.push({ surface: row.surface, reading: row.reading });
  }
  return keys;
}

export interface IpcDeps {
  settings: SettingsRepo;
  jmdict: JmdictRepo;
  jlpt: JlptRepo;
  sessions: SessionsRepo;
  words: WordsRepo;
  deck: DeckService;
  review: ReviewService;
  tokenizer: TokenizerService;
  appearances: AppearancesService;
  eventLog: EventLog;
  syncEngine: SyncEngine;
  syncEventsRepo: SyncEventsRepo;
  srs: SrsRepo;
  db: import('better-sqlite3').Database;
  getUpdateStatus: () => UpdateStatus;
}

export function registerIpcHandlers(deps: IpcDeps): void {
  let importing = false;

  function currentDictStatus(): DictStatus {
    if (importing) return { kind: 'importing', phase: 'parsing' };
    const count = deps.jmdict.entryCount();
    if (count === 0) return { kind: 'needs-import' };
    return { kind: 'ready', entryCount: count };
  }

  function currentTokenizerStatus(): TokenizerStatus {
    if (deps.tokenizer.isReady()) return { kind: 'ready' };
    const fail = deps.tokenizer.failure();
    if (fail) return { kind: 'failed', error: fail };
    return { kind: 'warming' };
  }

  // settings ---------------------------------------------------------------
  ipcMain.handle(IPC.PING, async (): Promise<PingResponse> => ok('pong'));

  ipcMain.handle(
    IPC.SETTINGS_GET,
    async (_e, req: SettingsGetRequest): Promise<SettingsGetResponse> => {
      try {
        return ok(deps.settings.get(req.key));
      } catch (e) {
        return err(safeError(e));
      }
    },
  );

  ipcMain.handle(
    IPC.SETTINGS_SET,
    async (_e, req: SettingsSetRequest): Promise<SettingsSetResponse> => {
      try {
        deps.settings.set(req.key, req.value);
        if (SYNCED_SETTING_KEYS.has(req.key)) {
          deps.eventLog.append('settings.set', {
            key: req.key,
            value: req.value,
          });
          deps.syncEngine.notifyLocalChange();
        }
        return ok(undefined);
      } catch (e) {
        return err(safeError(e));
      }
    },
  );

  // dictionary -------------------------------------------------------------
  ipcMain.handle(
    IPC.DICT_STATUS,
    async (): Promise<DictStatusResponse> => {
      try {
        return ok(currentDictStatus());
      } catch (e) {
        return err(safeError(e));
      }
    },
  );

  ipcMain.handle(IPC.DICT_IMPORT, async (): Promise<DictImportResponse> => {
    if (importing) return err('Import already in progress');
    importing = true;
    try {
      await importJmdict({
        repo: deps.jmdict,
        onStatus: (status) => broadcast(IPC.DICT_PROGRESS_EVENT, status),
      });
      // After dictionary import, attempt to load JLPT data (cheap, idempotent).
      const result = importJlpt(deps.jlpt);
      console.log(
        `[jlpt] loaded ${result.loaded} entries from ${result.source} source`,
      );
      broadcast(IPC.DICT_PROGRESS_EVENT, currentDictStatus());
      return ok(undefined);
    } catch (e) {
      return err(safeError(e));
    } finally {
      importing = false;
    }
  });

  ipcMain.handle(
    IPC.DICT_LOOKUP,
    async (_e, req: DictLookupRequest): Promise<DictLookupResponse> => {
      try {
        return ok(deps.jmdict.lookup(req.key));
      } catch (e) {
        return err(safeError(e));
      }
    },
  );

  ipcMain.handle(
    IPC.DICT_LOOKUP_WORD,
    async (_e, req: WordLookupRequest): Promise<WordLookupResponse> => {
      try {
        return ok(lookupWord(req, { jmdict: deps.jmdict, jlpt: deps.jlpt }));
      } catch (e) {
        return err(safeError(e));
      }
    },
  );

  // tokenizer --------------------------------------------------------------
  ipcMain.handle(
    IPC.TOKENIZER_STATUS,
    async (): Promise<TokenizerStatusResponse> => {
      try {
        return ok(currentTokenizerStatus());
      } catch (e) {
        return err(safeError(e));
      }
    },
  );

  ipcMain.handle(
    IPC.TOKENIZER_TOKENIZE,
    async (_e, req: TokenizeRequest): Promise<TokenizeResponse> => {
      try {
        if (!deps.tokenizer.isReady()) {
          return err('Tokenizer is not ready yet');
        }
        return ok(deps.tokenizer.tokenize(req.text));
      } catch (e) {
        return err(safeError(e));
      }
    },
  );

  // sessions ---------------------------------------------------------------
  ipcMain.handle(
    IPC.SESSION_SAVE,
    async (_e, req: SessionSaveRequest): Promise<SessionSaveResponse> => {
      try {
        const id = deps.sessions.saveOrReuse({
          rawText: req.rawText,
          processedTokensJson: JSON.stringify(req.tokens),
        });
        // Recompute per-session appearance counts so the My Words list stays
        // accurate when a session is re-tokenized with different text.
        deps.appearances.syncForSession(id, req.tokens);
        deps.eventLog.append('session.save', {
          rawText: req.rawText,
          tokens: req.tokens,
          createdAt: new Date().toISOString(),
        });
        deps.syncEngine.notifyLocalChange();
        return ok({ id });
      } catch (e) {
        return err(safeError(e));
      }
    },
  );

  // deck -------------------------------------------------------------------
  ipcMain.handle(
    IPC.DECK_ADD,
    async (_e, req: DeckAddRequest): Promise<DeckAddResponse> => {
      try {
        const entry = deps.deck.addWord({
          surface: req.surface,
          reading: req.reading,
          jlptLevel: req.jlptLevel,
          pos: req.pos,
          meanings: req.meanings,
          firstSessionId: req.sessionId,
          firstSentence: req.firstSentence,
          ...(req.asKnown != null ? { asKnown: req.asKnown } : {}),
        });
        // Resolve session by raw_text so peers can replay against their own
        // local session id (which may differ).
        const firstSessionRawText = req.sessionId != null
          ? deps.sessions.get(req.sessionId)?.raw_text ?? null
          : null;
        deps.eventLog.append('word.add', {
          surface: req.surface,
          reading: req.reading,
          jlptLevel: req.jlptLevel,
          pos: req.pos,
          meanings: req.meanings,
          firstSentence: req.firstSentence,
          firstSessionRawText,
          asKnown: req.asKnown ?? false,
        });
        deps.syncEngine.notifyLocalChange();
        return ok(entry);
      } catch (e) {
        return err(safeError(e));
      }
    },
  );

  ipcMain.handle(
    IPC.DECK_REMOVE,
    async (_e, req: DeckRemoveRequest): Promise<DeckRemoveResponse> => {
      try {
        deps.deck.removeWord(req.surface, req.reading);
        deps.eventLog.append('word.remove', {
          surface: req.surface,
          reading: req.reading,
        });
        deps.syncEngine.notifyLocalChange();
        return ok(undefined);
      } catch (e) {
        return err(safeError(e));
      }
    },
  );

  ipcMain.handle(
    IPC.DECK_STATE,
    async (_e, req: DeckStateRequest): Promise<DeckStateResponse> => {
      try {
        return ok(deps.deck.state(req.surface, req.reading));
      } catch (e) {
        return err(safeError(e));
      }
    },
  );

  ipcMain.handle(
    IPC.DECK_STATES_BATCH,
    async (
      _e,
      req: DeckStatesBatchRequest,
    ): Promise<DeckStatesBatchResponse> => {
      try {
        return ok(deps.deck.statesBatch(req.keys));
      } catch (e) {
        return err(safeError(e));
      }
    },
  );

  // review -----------------------------------------------------------------
  ipcMain.handle(IPC.REVIEW_QUEUE, async (): Promise<ReviewQueueResponse> => {
    try {
      const cards = deps.review.queue();
      return ok(
        cards.map((c) => ({
          wordId: c.wordId,
          surface: c.surface,
          reading: c.reading,
          pos: c.pos,
          jlptLevel: c.jlptLevel,
          meanings: c.meanings,
          firstSentence: c.firstSentence,
          state: c.state,
          reviewCount: c.reviewCount,
        })),
      );
    } catch (e) {
      return err(safeError(e));
    }
  });

  ipcMain.handle(
    IPC.REVIEW_SUBMIT,
    async (_e, req: ReviewSubmitRequest): Promise<ReviewSubmitResponse> => {
      try {
        const result = deps.review.submit({
          wordId: req.wordId,
          rating: req.rating,
        });
        deps.syncEngine.notifyLocalChange();
        return ok(result);
      } catch (e) {
        return err(safeError(e));
      }
    },
  );

  // words list -------------------------------------------------------------
  ipcMain.handle(
    IPC.WORDS_LIST,
    async (_e, req: WordsListRequest): Promise<WordsListResponse> => {
      try {
        return ok(deps.words.list(req));
      } catch (e) {
        return err(safeError(e));
      }
    },
  );

  ipcMain.handle(
    IPC.WORDS_BULK_DELETE,
    async (_e, req: WordsBulkRequest): Promise<WordsBulkResponse> => {
      try {
        const keys = collectWordKeys(deps.words, req.ids);
        const count = deps.words.bulkRemove(req.ids);
        if (keys.length > 0) {
          deps.eventLog.append('words.bulk-delete', { keys });
          deps.syncEngine.notifyLocalChange();
        }
        return ok({ count });
      } catch (e) {
        return err(safeError(e));
      }
    },
  );

  ipcMain.handle(
    IPC.WORDS_BULK_MARK_KNOWN,
    async (_e, req: WordsBulkRequest): Promise<WordsBulkResponse> => {
      try {
        const keys = collectWordKeys(deps.words, req.ids);
        const count = deps.words.bulkMarkKnown(req.ids);
        if (keys.length > 0) {
          deps.eventLog.append('words.bulk-mark-known', { keys });
          deps.syncEngine.notifyLocalChange();
        }
        return ok({ count });
      } catch (e) {
        return err(safeError(e));
      }
    },
  );

  // sessions list ----------------------------------------------------------
  ipcMain.handle(
    IPC.SESSIONS_LIST,
    async (): Promise<SessionsListResponse> => {
      try {
        return ok(deps.sessions.listWithStats());
      } catch (e) {
        return err(safeError(e));
      }
    },
  );

  ipcMain.handle(
    IPC.SESSION_GET,
    async (_e, req: SessionGetRequest): Promise<SessionGetResponse> => {
      try {
        const row = deps.sessions.get(req.id);
        if (!row) return ok(null);
        let tokens: Token[] = [];
        try {
          const parsed: unknown = JSON.parse(row.processed_tokens_json);
          if (Array.isArray(parsed)) tokens = parsed as Token[];
        } catch {
          tokens = [];
        }
        return ok({
          id: row.id,
          createdAt: row.created_at,
          title: row.title,
          rawText: row.raw_text,
          tokens,
        });
      } catch (e) {
        return err(safeError(e));
      }
    },
  );

  ipcMain.handle(
    IPC.SESSION_DELETE,
    async (_e, req: SessionDeleteRequest): Promise<SessionDeleteResponse> => {
      try {
        const row = deps.sessions.get(req.id);
        deps.sessions.remove(req.id);
        if (row) {
          deps.eventLog.append('session.delete', { rawText: row.raw_text });
          deps.syncEngine.notifyLocalChange();
        }
        return ok(undefined);
      } catch (e) {
        return err(safeError(e));
      }
    },
  );

  // auto-updater ----------------------------------------------------------
  ipcMain.handle(
    IPC.UPDATE_STATUS,
    async (): Promise<UpdateStatusResponse> => {
      try {
        return ok(deps.getUpdateStatus());
      } catch (e) {
        return err(safeError(e));
      }
    },
  );

  ipcMain.handle(
    IPC.UPDATE_INSTALL,
    async (): Promise<UpdateInstallResponse> => {
      try {
        quitAndInstall();
        return ok(undefined);
      } catch (e) {
        return err(safeError(e));
      }
    },
  );

  // sync ------------------------------------------------------------------
  ipcMain.handle(IPC.SYNC_INFO, async (): Promise<SyncInfoResponse> => {
    try {
      const lastPushed = deps.settings.get('syncLastPushedId') ?? '';
      const pendingPushCount = deps.syncEventsRepo.countLocalSince(
        deps.eventLog.deviceId,
        lastPushed,
      );
      return ok({
        deviceId: deps.eventLog.deviceId,
        folder: deps.syncEngine.resolvedFolder(),
        status: deps.syncEngine.status(),
        peers: deps.syncEngine.peers(),
        pendingPushCount,
      });
    } catch (e) {
      return err(safeError(e));
    }
  });

  ipcMain.handle(IPC.SYNC_RUN, async (): Promise<SyncRunResponse> => {
    try {
      await deps.syncEngine.run();
      return ok(undefined);
    } catch (e) {
      return err(safeError(e));
    }
  });

  ipcMain.handle(
    IPC.SYNC_SET_FOLDER,
    async (_e, req: SyncSetFolderRequest): Promise<SyncSetFolderResponse> => {
      try {
        await deps.syncEngine.setFolder(req.folder);
        return ok(undefined);
      } catch (e) {
        return err(safeError(e));
      }
    },
  );

  ipcMain.handle(IPC.SYNC_RESET, async (): Promise<SyncResetResponse> => {
    try {
      deps.syncEngine.reset();
      await deps.syncEngine.run();
      return ok(undefined);
    } catch (e) {
      return err(safeError(e));
    }
  });

  ipcMain.handle(
    IPC.SYNC_BACKFILL,
    async (): Promise<SyncBackfillResponse> => {
      try {
        const result = runBackfill({
          db: deps.db,
          sessions: deps.sessions,
          words: deps.words,
          srs: deps.srs,
          eventLog: deps.eventLog,
        });
        // Kick off a sync so the new events push to the iCloud folder.
        await deps.syncEngine.run();
        return ok(result);
      } catch (e) {
        return err(safeError(e));
      }
    },
  );
}
