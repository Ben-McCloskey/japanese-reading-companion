import path from 'node:path';
import { app, BrowserWindow, shell } from 'electron';
import { openDb, getDbPath, closeDb } from './db/connection';
import { runMigrations } from './db/migrations';
import { createSettingsRepo } from './db/repos/settings-repo';
import { createJmdictRepo } from './db/repos/jmdict-repo';
import { createJlptRepo } from './db/repos/jlpt-repo';
import { createSessionsRepo } from './db/repos/sessions-repo';
import { createWordsRepo } from './db/repos/words-repo';
import { createSrsRepo } from './db/repos/srs-repo';
import { createDeckService } from './services/deck';
import { createReviewsRepo } from './db/repos/reviews-repo';
import { createReviewService } from './services/review';
import { createAppearancesRepo } from './db/repos/appearances-repo';
import { createAppearancesService } from './services/appearances';
import { createSyncEventsRepo } from './db/repos/sync-events-repo';
import { createEventLog, ensureDeviceId } from './services/sync/event-log';
import { createEventReplayer } from './services/sync/event-replay';
import { createSyncEngine } from './services/sync/engine';
import { startAutoUpdater } from './services/auto-updater';
import { createTokenizerService } from './services/tokenizer';
import type { UpdateStatus } from '@shared/ipc';
import { registerIpcHandlers } from './ipc/register';
import { broadcast } from './ipc/events';
import { IPC, type TokenizerStatus } from '@shared/ipc';

const isDev = !app.isPackaged;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: '#0b0b0d',
    titleBarStyle: 'hiddenInset',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (isDev && devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  return win;
}

void app.whenReady().then(() => {
  const db = openDb();
  console.log('[main] DB opened at', getDbPath());
  runMigrations(db);

  const settings = createSettingsRepo(db);
  const jmdict = createJmdictRepo(db);
  const jlpt = createJlptRepo(db);
  const sessions = createSessionsRepo(db);
  const words = createWordsRepo(db);
  const srs = createSrsRepo(db);
  const reviews = createReviewsRepo(db);
  const appearancesRepo = createAppearancesRepo(db);
  const appearances = createAppearancesService({
    sessions,
    words,
    appearances: appearancesRepo,
  });
  const deck = createDeckService({ words, srs, appearances });
  const syncEventsRepo = createSyncEventsRepo(db);
  const deviceId = ensureDeviceId(settings);
  const eventLog = createEventLog({ deviceId, syncEvents: syncEventsRepo });
  const review = createReviewService({ db, srs, reviews, words, eventLog });
  const tokenizer = createTokenizerService();

  const replayer = createEventReplayer({
    db,
    settings,
    words,
    sessions,
    srs,
    reviews,
    deck,
    appearances,
  });
  const syncEngine = createSyncEngine({
    syncEvents: syncEventsRepo,
    settings,
    replayer,
    deviceId,
    onStatusChange: (status) => broadcast(IPC.SYNC_STATUS_EVENT, status),
  });

  let lastUpdateStatus: UpdateStatus = { kind: 'idle' };

  registerIpcHandlers({
    settings,
    jmdict,
    jlpt,
    sessions,
    words,
    deck,
    review,
    tokenizer,
    appearances,
    eventLog,
    syncEngine,
    syncEventsRepo,
    srs,
    db,
    getUpdateStatus: () => lastUpdateStatus,
  });

  syncEngine.start();

  // Auto-updater is a no-op in dev (electron-updater short-circuits when the
  // app isn't packaged). In production it polls GitHub Releases for new tags.
  if (app.isPackaged) {
    startAutoUpdater({
      onStatus: (status) => {
        lastUpdateStatus = status;
        broadcast(IPC.UPDATE_STATUS_EVENT, status);
      },
    });
  }

  // Notify the renderer when tokenizer warmup finishes.
  void tokenizer.ready.then(() => {
    const status: TokenizerStatus = tokenizer.isReady()
      ? { kind: 'ready' }
      : { kind: 'failed', error: tokenizer.failure() ?? 'unknown error' };
    broadcast(IPC.TOKENIZER_READY_EVENT, status);
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  closeDb();
});

// Engine is stopped by closeDb-adjacent cleanup paths if the app process
// goes away while a run is in flight; the worst case is that pendingPushCount
// shows >0 next launch and the next push catches up.
