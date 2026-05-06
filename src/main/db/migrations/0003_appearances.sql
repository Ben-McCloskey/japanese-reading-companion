CREATE TABLE word_session_appearances (
  word_id    INTEGER NOT NULL,
  session_id INTEGER NOT NULL,
  count      INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (word_id, session_id),
  FOREIGN KEY (word_id)    REFERENCES words(id)    ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_appearances_word ON word_session_appearances(word_id);
