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
import { importJmdict } from '@main/services/dictionary/importer';
import { importJlpt } from '@main/services/dictionary/jlpt-importer';
import { lookupWord } from '@main/services/dictionary/lookup';
import { broadcast } from './events';

function safeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
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
        return ok({ count: deps.words.bulkRemove(req.ids) });
      } catch (e) {
        return err(safeError(e));
      }
    },
  );

  ipcMain.handle(
    IPC.WORDS_BULK_MARK_KNOWN,
    async (_e, req: WordsBulkRequest): Promise<WordsBulkResponse> => {
      try {
        return ok({ count: deps.words.bulkMarkKnown(req.ids) });
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
        deps.sessions.remove(req.id);
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
}
