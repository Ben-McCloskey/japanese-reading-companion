-- Append-only operation log replicated across devices via iCloud Drive.
-- One row per state-changing mutation (locally produced or replayed from a
-- remote peer). Replay logic uses natural keys (surface+reading, raw_text,
-- etc.) inside payload_json so primary-key drift between devices is fine.

CREATE TABLE sync_events (
  id           TEXT PRIMARY KEY,             -- sortable: <iso-ts>-<uuid>
  device_id    TEXT NOT NULL,
  ts           TEXT NOT NULL,                -- ISO 8601
  kind         TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE INDEX idx_sync_events_ts ON sync_events(ts);
CREATE INDEX idx_sync_events_device_id ON sync_events(device_id, id);

-- Tracks how far we've ingested events from each remote peer's log file.
-- last_event_id is the highest event id we've already applied from that peer.
CREATE TABLE sync_peers (
  device_id     TEXT PRIMARY KEY,
  last_event_id TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
