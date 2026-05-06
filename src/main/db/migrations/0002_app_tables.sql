-- User-facing data ----------------------------------------------------------

CREATE TABLE sessions (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at             TEXT    NOT NULL DEFAULT (datetime('now')),
  title                  TEXT    NOT NULL,
  raw_text               TEXT    NOT NULL,
  processed_tokens_json  TEXT    NOT NULL
);

CREATE INDEX idx_sessions_created_at ON sessions(created_at DESC);

CREATE TABLE words (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  surface                 TEXT    NOT NULL,        -- dictionary form
  reading                 TEXT    NOT NULL,        -- kana
  jlpt_level              INTEGER,                  -- 1..5 or NULL
  pos                     TEXT    NOT NULL,        -- comma-joined POS list
  meanings_json           TEXT    NOT NULL,        -- JSON: senses[]
  example_sentences_json  TEXT,                     -- JSON or NULL
  created_at              TEXT    NOT NULL DEFAULT (datetime('now')),
  first_session_id        INTEGER,
  first_sentence          TEXT,
  UNIQUE (surface, reading),
  FOREIGN KEY (first_session_id) REFERENCES sessions(id) ON DELETE SET NULL
);

CREATE INDEX idx_words_surface_reading ON words(surface, reading);

CREATE TABLE srs_state (
  word_id          INTEGER PRIMARY KEY,
  state            TEXT    NOT NULL CHECK (state IN ('new','learning','review','lapsed','known')),
  due_date         TEXT,
  stability        REAL    NOT NULL DEFAULT 0,
  difficulty       REAL    NOT NULL DEFAULT 0,
  review_count     INTEGER NOT NULL DEFAULT 0,
  lapse_count      INTEGER NOT NULL DEFAULT 0,
  last_reviewed_at TEXT,
  FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE
);

CREATE INDEX idx_srs_due ON srs_state(due_date);

CREATE TABLE reviews (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  word_id           INTEGER NOT NULL,
  reviewed_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  rating            INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 4),
  interval_before   REAL,
  interval_after    REAL,
  stability_before  REAL,
  stability_after   REAL,
  FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE
);

CREATE INDEX idx_reviews_word ON reviews(word_id, reviewed_at);

-- JMdict cache --------------------------------------------------------------

CREATE TABLE jmdict_entries (
  ent_seq    INTEGER PRIMARY KEY,
  data_json  TEXT    NOT NULL
);

CREATE TABLE jmdict_index (
  key        TEXT    NOT NULL,
  ent_seq    INTEGER NOT NULL,
  is_reading INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (ent_seq) REFERENCES jmdict_entries(ent_seq) ON DELETE CASCADE
);

CREATE INDEX idx_jmdict_index_key ON jmdict_index(key);

-- JLPT level mapping --------------------------------------------------------

CREATE TABLE jlpt_levels (
  key   TEXT    PRIMARY KEY, -- surface form OR reading form
  level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 5)
);
