import type { SyncDriver } from './icloud-driver';
import { createSyncDriver, defaultSyncFolder } from './icloud-driver';
import type { SyncEventsRepo } from '@main/db/repos/sync-events-repo';
import type { SettingsRepo } from '@main/db/repos/settings-repo';
import type { EventReplayer } from './event-replay';
import type { SyncEvent } from '@shared/types/sync';

const LAST_PUSHED_KEY = 'syncLastPushedId';
const SYNC_FOLDER_KEY = 'syncFolder';
const PUSH_INTERVAL_MS = 15_000;
const PULL_INTERVAL_MS = 30_000;
const PEER_FILE_PREFIX = 'events-';
const PEER_FILE_SUFFIX = '.jsonl';

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

export interface SyncEngine {
  status(): SyncStatus;
  resolvedFolder(): string;
  peers(): SyncPeerInfo[];
  run(): Promise<void>;
  setFolder(folderPath: string | null): Promise<void>;
  reset(): void;
  start(): void;
  stop(): void;
  notifyLocalChange(): void;
}

interface EngineDeps {
  syncEvents: SyncEventsRepo;
  settings: SettingsRepo;
  replayer: EventReplayer;
  deviceId: string;
  onStatusChange: (s: SyncStatus) => void;
}

export function createSyncEngine(deps: EngineDeps): SyncEngine {
  let driver: SyncDriver = createSyncDriver(currentFolder());
  let currentStatus: SyncStatus = { kind: 'idle' };
  let pushTimer: NodeJS.Timeout | null = null;
  let pullTimer: NodeJS.Timeout | null = null;
  let unwatch: (() => void) | null = null;
  let inFlight: Promise<void> | null = null;
  let pendingRun = false;
  let started = false;

  function currentFolder(): string {
    const explicit = deps.settings.get(SYNC_FOLDER_KEY);
    if (explicit && explicit.trim().length > 0) return explicit.trim();
    return defaultSyncFolder();
  }

  function setStatus(s: SyncStatus): void {
    currentStatus = s;
    deps.onStatusChange(s);
  }

  function selfFile(): string {
    return `${PEER_FILE_PREFIX}${deps.deviceId}${PEER_FILE_SUFFIX}`;
  }

  async function pushLocal(): Promise<void> {
    setStatus({ kind: 'pushing' });
    const lastPushed = deps.settings.get(LAST_PUSHED_KEY) ?? '';
    const events = deps.syncEvents.listLocalSince(
      deps.deviceId,
      lastPushed,
      1000,
    );
    if (events.length === 0) return;
    const lines = events.map((e) => JSON.stringify(e));
    await driver.appendLines(selfFile(), lines);
    const last = events[events.length - 1];
    if (last) deps.settings.set(LAST_PUSHED_KEY, last.id);
  }

  async function pullPeers(): Promise<void> {
    setStatus({ kind: 'pulling' });
    const files = await driver.listFiles();
    const me = selfFile();
    const peerFiles = files.filter(
      (f) =>
        f.startsWith(PEER_FILE_PREFIX) &&
        f.endsWith(PEER_FILE_SUFFIX) &&
        f !== me,
    );
    for (const file of peerFiles) {
      const peerDeviceId = file.slice(
        PEER_FILE_PREFIX.length,
        file.length - PEER_FILE_SUFFIX.length,
      );
      if (!peerDeviceId) continue;
      const content = await driver.readFile(file);
      if (!content) continue;
      const peer = deps.syncEvents.getPeer(peerDeviceId);
      const lastSeen = peer?.lastEventId ?? '';
      let lastApplied = lastSeen;

      const lines = content.split('\n');
      for (const raw of lines) {
        const line = raw.trim();
        if (line.length === 0) continue;
        let event: SyncEvent;
        try {
          event = JSON.parse(line) as SyncEvent;
        } catch {
          // Partial write or in-transit corruption — pick up next pull.
          continue;
        }
        if (!event || typeof event.id !== 'string') continue;
        if (event.id <= lastSeen) continue;
        if (deps.syncEvents.has(event.id)) {
          // We've ingested this event before (e.g. via a previous run that
          // crashed mid-cursor-update). Just advance the cursor.
          if (event.id > lastApplied) lastApplied = event.id;
          continue;
        }
        deps.syncEvents.insertEvent(event);
        try {
          deps.replayer.apply(event);
        } catch (e) {
          // One bad event shouldn't stall the whole stream. The peer cursor
          // still advances so we don't loop on it forever — we'll find the
          // gap if dependent events later need a missing prerequisite.
          console.error('[sync] replay failed for', event.id, e);
        }
        if (event.id > lastApplied) lastApplied = event.id;
      }
      if (lastApplied > lastSeen) {
        deps.syncEvents.upsertPeer(peerDeviceId, lastApplied);
      }
    }
  }

  async function run(): Promise<void> {
    if (inFlight) {
      pendingRun = true;
      return inFlight;
    }
    inFlight = (async () => {
      try {
        await driver.ensureFolder();
        await pushLocal();
        await pullPeers();
        setStatus({ kind: 'idle' });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setStatus({ kind: 'error', error: msg });
      } finally {
        inFlight = null;
        if (pendingRun) {
          pendingRun = false;
          void run();
        }
      }
    })();
    return inFlight;
  }

  function attachWatch(): void {
    if (unwatch) unwatch();
    unwatch = driver.watch(() => void run());
  }

  function start(): void {
    if (started) return;
    started = true;
    void run();
    pushTimer = setInterval(() => {
      // Push cycles are cheap — just a no-op if no new local events.
      void run();
    }, PUSH_INTERVAL_MS);
    pullTimer = setInterval(() => {
      void run();
    }, PULL_INTERVAL_MS);
    attachWatch();
  }

  function stop(): void {
    started = false;
    if (pushTimer) {
      clearInterval(pushTimer);
      pushTimer = null;
    }
    if (pullTimer) {
      clearInterval(pullTimer);
      pullTimer = null;
    }
    if (unwatch) {
      unwatch();
      unwatch = null;
    }
  }

  async function setFolder(folderPath: string | null): Promise<void> {
    deps.settings.set(SYNC_FOLDER_KEY, folderPath ?? '');
    const wasStarted = started;
    stop();
    driver = createSyncDriver(currentFolder());
    if (wasStarted) start();
    else await run();
  }

  function reset(): void {
    // Forget what we've pulled from peers. Their files are unchanged, so
    // the next pull will re-ingest events from id > '' — insertEvent's
    // ON CONFLICT DO NOTHING dedupes against the local sync_events table.
    // This is the recovery path after the peer table got corrupted or the
    // user wants to re-apply remote events from scratch.
    for (const peer of deps.syncEvents.listPeers()) {
      deps.syncEvents.upsertPeer(peer.deviceId, '');
    }
  }

  return {
    status: () => currentStatus,
    resolvedFolder: () => driver.resolvedPath,
    peers: () => deps.syncEvents.listPeers(),
    run,
    setFolder,
    reset,
    start,
    stop,
    notifyLocalChange() {
      // Hint that local events were just appended; piggyback on a debounced
      // run rather than running synchronously inside an IPC handler.
      void run();
    },
  };
}
