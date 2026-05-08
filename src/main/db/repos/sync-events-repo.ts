import type { Database } from 'better-sqlite3';
import type { SyncEvent, SyncEventKind } from '@shared/types/sync';

interface SyncEventRow {
  id: string;
  device_id: string;
  ts: string;
  kind: string;
  payload_json: string;
}

interface SyncPeerRow {
  device_id: string;
  last_event_id: string;
  last_seen_at: string;
}

function rowToEvent(row: SyncEventRow): SyncEvent {
  // Trust producer to write a payload that matches its kind. JSON.parse is
  // safe here because event-log.ts is the only writer.
  const payload = JSON.parse(row.payload_json) as SyncEvent['payload'];
  return {
    id: row.id,
    deviceId: row.device_id,
    ts: row.ts,
    kind: row.kind as SyncEventKind,
    payload,
  };
}

export function createSyncEventsRepo(db: Database) {
  const insert = db.prepare<{
    id: string;
    device_id: string;
    ts: string;
    kind: string;
    payload_json: string;
  }>(
    `INSERT INTO sync_events (id, device_id, ts, kind, payload_json)
     VALUES (@id, @device_id, @ts, @kind, @payload_json)
     ON CONFLICT(id) DO NOTHING`,
  );

  const existsStmt = db.prepare<{ id: string }, { id: string }>(
    'SELECT id FROM sync_events WHERE id = @id',
  );

  const listAfter = db.prepare<
    { device_id: string; after_id: string; limit: number },
    SyncEventRow
  >(
    `SELECT * FROM sync_events
      WHERE device_id = @device_id AND id > @after_id
      ORDER BY id ASC
      LIMIT @limit`,
  );

  const listLocalAfter = db.prepare<
    { device_id: string; after_id: string; limit: number },
    SyncEventRow
  >(
    // Same as listAfter but explicit about scoping to a single device's log.
    `SELECT * FROM sync_events
      WHERE device_id = @device_id AND id > @after_id
      ORDER BY id ASC
      LIMIT @limit`,
  );

  const peerSelect = db.prepare<{ device_id: string }, SyncPeerRow>(
    'SELECT * FROM sync_peers WHERE device_id = @device_id',
  );
  const peerUpsert = db.prepare<{
    device_id: string;
    last_event_id: string;
  }>(
    `INSERT INTO sync_peers (device_id, last_event_id, last_seen_at)
     VALUES (@device_id, @last_event_id, datetime('now'))
     ON CONFLICT(device_id) DO UPDATE SET
       last_event_id = excluded.last_event_id,
       last_seen_at  = excluded.last_seen_at`,
  );
  const peerList = db.prepare<[], SyncPeerRow>(
    'SELECT * FROM sync_peers ORDER BY last_seen_at DESC',
  );

  return {
    insertEvent(event: SyncEvent): void {
      insert.run({
        id: event.id,
        device_id: event.deviceId,
        ts: event.ts,
        kind: event.kind,
        payload_json: JSON.stringify(event.payload),
      });
    },

    has(id: string): boolean {
      return existsStmt.get({ id }) != null;
    },

    listSince(deviceId: string, afterId: string, limit = 1000): SyncEvent[] {
      return listAfter
        .all({ device_id: deviceId, after_id: afterId, limit })
        .map(rowToEvent);
    },

    listLocalSince(
      deviceId: string,
      afterId: string,
      limit = 1000,
    ): SyncEvent[] {
      return listLocalAfter
        .all({ device_id: deviceId, after_id: afterId, limit })
        .map(rowToEvent);
    },

    countLocalSince(deviceId: string, afterId: string): number {
      const row = db
        .prepare<
          { device_id: string; after_id: string },
          { c: number }
        >(
          `SELECT COUNT(*) AS c FROM sync_events
            WHERE device_id = @device_id AND id > @after_id`,
        )
        .get({ device_id: deviceId, after_id: afterId });
      return row?.c ?? 0;
    },

    getPeer(deviceId: string): { deviceId: string; lastEventId: string } | null {
      const row = peerSelect.get({ device_id: deviceId });
      return row
        ? { deviceId: row.device_id, lastEventId: row.last_event_id }
        : null;
    },

    upsertPeer(deviceId: string, lastEventId: string): void {
      peerUpsert.run({ device_id: deviceId, last_event_id: lastEventId });
    },

    listPeers(): Array<{
      deviceId: string;
      lastEventId: string;
      lastSeenAt: string;
    }> {
      return peerList.all().map((r) => ({
        deviceId: r.device_id,
        lastEventId: r.last_event_id,
        lastSeenAt: r.last_seen_at,
      }));
    },
  };
}

export type SyncEventsRepo = ReturnType<typeof createSyncEventsRepo>;
