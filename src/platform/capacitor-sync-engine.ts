import type {
  CapacitorSyncDriver,
} from './capacitor-icloud-driver';
import { createCapacitorIcloudDriver } from './capacitor-icloud-driver';
import { db, query, queryOne, run } from './capacitor-db';
import { applyEvent } from './capacitor-replayer';
import { ingest, deviceId } from './capacitor-event-log';
import type { SyncEvent, SyncEventKind } from '@shared/types/sync';
import type { SyncStatus, SyncPeerInfo } from '@shared/ipc';

const LAST_PUSHED_KEY = 'syncLastPushedId';
const PUSH_INTERVAL_MS = 15_000;
const PULL_INTERVAL_MS = 30_000;
const PEER_FILE_PREFIX = 'events-';
const PEER_FILE_SUFFIX = '.jsonl';
// Hard floor between cycle starts so a stuck `pendingRun` cascade can't
// starve the rest of the app. Even if something keeps requesting cycles,
// at most one runs per this window.
const MIN_CYCLE_GAP_MS = 2_000;

/**
 * iOS sync engine. Pulls and pushes events through the iCloud driver.
 * Structurally identical to src/main/services/sync/engine.ts but async
 * end-to-end (Capacitor SQLite + iCloud plugin are both promise-based).
 */
export interface CapacitorSyncEngine {
  status(): SyncStatus;
  resolvedFolder(): string | null;
  peers(): Promise<SyncPeerInfo[]>;
  pendingPushCount(): Promise<number>;
  run(): Promise<void>;
  start(): void;
  stop(): void;
  notifyLocalChange(): void;
  onStatusChange(cb: (s: SyncStatus) => void): () => void;
}

export function createCapacitorSyncEngine(): CapacitorSyncEngine {
  const driver: CapacitorSyncDriver = createCapacitorIcloudDriver();
  let currentStatus: SyncStatus = { kind: 'idle' };
  let pushTimer: ReturnType<typeof setInterval> | null = null;
  let pullTimer: ReturnType<typeof setInterval> | null = null;
  let unwatch: (() => void) | null = null;
  let inFlight: Promise<void> | null = null;
  let pendingRun = false;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let lastCycleStartedAt = 0;
  let started = false;
  let cycleEntryCount = 0;
  const listeners = new Set<(s: SyncStatus) => void>();

  function setStatus(s: SyncStatus): void {
    currentStatus = s;
    for (const cb of listeners) cb(s);
  }

  async function selfFile(): Promise<string> {
    const id = await deviceId();
    return `${PEER_FILE_PREFIX}${id}${PEER_FILE_SUFFIX}`;
  }

  async function getLastPushed(): Promise<string> {
    const row = await queryOne<{ value: string }>(
      'SELECT value FROM settings WHERE key = ?',
      [LAST_PUSHED_KEY],
    );
    return row?.value ?? '';
  }

  async function setLastPushed(id: string): Promise<void> {
    await run(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [LAST_PUSHED_KEY, id],
    );
  }

  async function pushLocal(): Promise<void> {
    setStatus({ kind: 'pushing' });
    const me = await deviceId();
    const lastPushed = await getLastPushed();
    const rows = await query<{
      id: string;
      device_id: string;
      ts: string;
      kind: string;
      payload_json: string;
    }>(
      `SELECT id, device_id, ts, kind, payload_json
         FROM sync_events
        WHERE device_id = ? AND id > ?
        ORDER BY id ASC
        LIMIT 1000`,
      [me, lastPushed],
    );
    if (rows.length === 0) return;
    const lines = rows.map((r) => {
      const event: SyncEvent = {
        id: r.id,
        deviceId: r.device_id,
        ts: r.ts,
        kind: r.kind as SyncEventKind,
        payload: JSON.parse(r.payload_json) as SyncEvent['payload'],
      };
      return JSON.stringify(event);
    });
    await driver.appendLines(await selfFile(), lines);
    const last = rows[rows.length - 1];
    if (last) await setLastPushed(last.id);
  }

  async function pullPeers(): Promise<void> {
    setStatus({ kind: 'pulling' });
    const files = await driver.listFiles();
    const me = await selfFile();
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
      const peerRow = await queryOne<{ last_event_id: string }>(
        'SELECT last_event_id FROM sync_peers WHERE device_id = ?',
        [peerDeviceId],
      );
      const lastSeen = peerRow?.last_event_id ?? '';
      let lastApplied = lastSeen;

      for (const raw of content.split('\n')) {
        const line = raw.trim();
        if (line.length === 0) continue;
        let event: SyncEvent;
        try {
          event = JSON.parse(line) as SyncEvent;
        } catch {
          continue; // partial write or in-transit corruption
        }
        if (!event || typeof event.id !== 'string') continue;
        if (event.id <= lastSeen) continue;
        const wasNew = await ingest(event);
        if (wasNew) {
          try {
            await applyEvent(event);
          } catch (e) {
            // eslint-disable-next-line no-console
            console.error('[sync] replay failed for', event.id, e);
          }
        }
        if (event.id > lastApplied) lastApplied = event.id;
      }

      if (lastApplied > lastSeen) {
        await run(
          `INSERT INTO sync_peers (device_id, last_event_id, last_seen_at)
           VALUES (?, ?, datetime('now'))
           ON CONFLICT(device_id) DO UPDATE SET
             last_event_id = excluded.last_event_id,
             last_seen_at  = excluded.last_seen_at`,
          [peerDeviceId, lastApplied],
        );
      }
    }
  }

  async function runCycle(): Promise<void> {
    cycleEntryCount++;
    // Diagnostic: surface tight cycling. If we're getting hammered, log
    // the call stack so the offending code path is identifiable.
    if (cycleEntryCount % 10 === 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[sync] runCycle entered ${cycleEntryCount} times (likely a re-entry loop)`,
        new Error('runCycle stack').stack,
      );
    }

    if (inFlight) {
      pendingRun = true;
      return inFlight;
    }

    // Throttle: if the previous cycle started less than MIN_CYCLE_GAP_MS
    // ago, defer instead of running immediately. Coalesces bursty triggers
    // without dropping them.
    const now = Date.now();
    const elapsed = now - lastCycleStartedAt;
    if (elapsed < MIN_CYCLE_GAP_MS) {
      if (pendingTimer) return inFlight ?? Promise.resolve();
      pendingTimer = setTimeout(() => {
        pendingTimer = null;
        void runCycle();
      }, MIN_CYCLE_GAP_MS - elapsed);
      return Promise.resolve();
    }

    lastCycleStartedAt = now;
    inFlight = (async () => {
      try {
        await db(); // make sure migrations are done
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
          // Use setTimeout(0) instead of immediate void runCycle() so the
          // event loop gets a chance to process other work between cycles.
          setTimeout(() => void runCycle(), 0);
        }
      }
    })();
    return inFlight;
  }

  return {
    status: () => currentStatus,
    resolvedFolder: () => driver.resolvedPath(),

    async peers() {
      const rows = await query<{
        device_id: string;
        last_event_id: string;
        last_seen_at: string;
      }>(
        'SELECT device_id, last_event_id, last_seen_at FROM sync_peers ORDER BY last_seen_at DESC',
      );
      return rows.map((r) => ({
        deviceId: r.device_id,
        lastEventId: r.last_event_id,
        lastSeenAt: r.last_seen_at,
      }));
    },

    async pendingPushCount() {
      const me = await deviceId();
      const lastPushed = await getLastPushed();
      const row = await queryOne<{ c: number }>(
        `SELECT COUNT(*) AS c FROM sync_events
          WHERE device_id = ? AND id > ?`,
        [me, lastPushed],
      );
      return row?.c ?? 0;
    },

    run: runCycle,

    start() {
      if (started) return;
      started = true;
      void runCycle();
      pushTimer = setInterval(() => void runCycle(), PUSH_INTERVAL_MS);
      pullTimer = setInterval(() => void runCycle(), PULL_INTERVAL_MS);
      unwatch = driver.watch(() => void runCycle(), PULL_INTERVAL_MS);
    },

    stop() {
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
    },

    notifyLocalChange() {
      void runCycle();
    },

    onStatusChange(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}
