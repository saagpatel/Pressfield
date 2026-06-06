-- Pressfield session store schema. Embedded via include_str! and applied
-- idempotently on every open (v1 tables). Prose is stored in documents.body
-- (added in v2 via the PRAGMA user_version-gated migration in session_store.rs).

CREATE TABLE IF NOT EXISTS sessions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at      INTEGER NOT NULL,   -- unix ms
    ended_at        INTEGER,            -- NULL while active
    word_count      INTEGER NOT NULL DEFAULT 0,
    decay_events    INTEGER NOT NULL DEFAULT 0,  -- pauses > 5s that were recovered
    intensity       TEXT NOT NULL,      -- 'gentle' | 'normal' | 'brutal'
    document_id     INTEGER REFERENCES documents(id)  -- NULL for pre-migration sessions
);

CREATE TABLE IF NOT EXISTS keystrokes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    ts          INTEGER NOT NULL        -- unix ms of the keystroke
);

CREATE TABLE IF NOT EXISTS decay_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id      INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    started_at      INTEGER NOT NULL,   -- unix ms when idle exceeded threshold
    recovered_at    INTEGER,            -- unix ms when typing resumed; NULL if ended mid-decay
    peak_level      REAL NOT NULL       -- max decay_level reached before recovery
);

CREATE INDEX IF NOT EXISTS idx_keystrokes_session ON keystrokes(session_id);
CREATE INDEX IF NOT EXISTS idx_decay_session       ON decay_events(session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_started    ON sessions(started_at DESC);

-- v2: named documents with prose body. Fresh DBs get sessions.document_id from
-- the sessions CREATE TABLE above; real on-disk v1 databases acquire it via the
-- PRAGMA user_version-gated ALTER TABLE migration in session_store.rs.
CREATE TABLE IF NOT EXISTS documents (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    body        TEXT    NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL,  -- unix ms
    updated_at  INTEGER NOT NULL   -- unix ms
);

CREATE INDEX IF NOT EXISTS idx_documents_updated ON documents(updated_at DESC);

-- v3: global key/value settings store (e.g. the hardcore-mode flag). Added via
-- the PRAGMA user_version-gated v2→v3 migration in session_store.rs.
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
