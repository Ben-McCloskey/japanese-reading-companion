import type {
  SyncEvent,
  SyncEventKind,
  SyncEventPayloadOf,
} from '@shared/types/sync';
import { db, queryOne, run } from './capacitor-db';

/**
 * iOS event log — counterpart to src/main/services/sync/event-log.ts on
 * Mac. Same data shape (sortable id = ISO ts + uuid), same `sync_events`
 * table, same dedup-by-id semantics on ingest.
 *
 * Critical detail: while replaying remote events, locally-triggered
 * mutations (e.g. addToDeck called from the replayer) MUST NOT create new
 * sync_events rows — otherwise the local device would re-publish a
 * peer's event with its own id, and other peers would re-ingest it as
 * new, creating a loop. The `replaying` flag below blocks `append()`
 * during replay; the replayer is responsible for setting/clearing it.
 */

let replaying = false;
let cachedDeviceId: string | null = null;

/**
 * Run `fn` with the replay guard active. Any append() called transitively
 * during the function's execution is silently skipped.
 */
export async function withReplaying<T>(fn: () => Promise<T>): Promise<T> {
  const prev = replaying;
  replaying = true;
  try {
    return await fn();
  } finally {
    replaying = prev;
  }
}

export async function deviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;
  await db(); // ensure migrations + bootstrap have run
  const row = await queryOne<{ value: string }>(
    "SELECT value FROM settings WHERE key = 'deviceId'",
  );
  if (!row?.value) {
    throw new Error('deviceId missing from settings — DB bootstrap failed');
  }
  cachedDeviceId = row.value;
  return cachedDeviceId;
}

function newEventId(ts: string): string {
  return `${ts}-${crypto.randomUUID()}`;
}

export async function append<K extends SyncEventKind>(
  kind: K,
  payload: SyncEventPayloadOf<K>,
): Promise<SyncEvent<K> | null> {
  if (replaying) return null;
  const id = await deviceId();
  const ts = new Date().toISOString();
  const event = {
    id: newEventId(ts),
    deviceId: id,
    ts,
    kind,
    payload,
  };
  await run(
    `INSERT INTO sync_events (id, device_id, ts, kind, payload_json)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
    [event.id, event.deviceId, event.ts, event.kind, JSON.stringify(event.payload)],
  );
  return event;
}

/** Insert a remote event into sync_events. Returns false if it was already there. */
export async function ingest(event: SyncEvent): Promise<boolean> {
  const existing = await queryOne<{ id: string }>(
    'SELECT id FROM sync_events WHERE id = ?',
    [event.id],
  );
  if (existing) return false;
  await run(
    `INSERT INTO sync_events (id, device_id, ts, kind, payload_json)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
    [event.id, event.deviceId, event.ts, event.kind, JSON.stringify(event.payload)],
  );
  return true;
}
