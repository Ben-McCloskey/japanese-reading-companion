import { randomUUID } from 'node:crypto';
import type { SettingsRepo } from '@main/db/repos/settings-repo';
import type { SyncEventsRepo } from '@main/db/repos/sync-events-repo';
import type {
  SyncEvent,
  SyncEventKind,
  SyncEventPayloadOf,
} from '@shared/types/sync';

const DEVICE_ID_KEY = 'deviceId';

export function ensureDeviceId(settings: SettingsRepo): string {
  const existing = settings.get(DEVICE_ID_KEY);
  if (existing) return existing;
  const id = randomUUID();
  settings.set(DEVICE_ID_KEY, id);
  return id;
}

/**
 * Build a sortable event id: `<iso-timestamp>-<uuid-suffix>`. ISO timestamps
 * sort lexicographically the same way they sort chronologically, so peers can
 * stream events ordered by id. The UUID tail breaks ties from rapid writes
 * within the same millisecond and prevents id collisions across devices.
 */
function newEventId(ts: string): string {
  return `${ts}-${randomUUID()}`;
}

export interface EventLog {
  readonly deviceId: string;
  append<K extends SyncEventKind>(
    kind: K,
    payload: SyncEventPayloadOf<K>,
  ): SyncEvent<K>;
  ingest(event: SyncEvent): boolean;
}

export function createEventLog(deps: {
  deviceId: string;
  syncEvents: SyncEventsRepo;
}): EventLog {
  return {
    deviceId: deps.deviceId,

    append(kind, payload) {
      const ts = new Date().toISOString();
      const event = {
        id: newEventId(ts),
        deviceId: deps.deviceId,
        ts,
        kind,
        payload,
      };
      deps.syncEvents.insertEvent(event);
      return event;
    },

    ingest(event) {
      if (deps.syncEvents.has(event.id)) return false;
      deps.syncEvents.insertEvent(event);
      return true;
    },
  };
}
