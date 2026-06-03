-- Pressfield session store schema. Embedded via include_str! and applied
-- idempotently on every open. Holds only counts and timestamps — never prose.

CREATE TABLE IF NOT EXISTS sessions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at      INTEGER NOT NULL,   -- unix ms
    ended_at        INTEGER,            -- NULL while active
    word_count      INTEGER NOT NULL DEFAULT 0,
    decay_events    INTEGER NOT NULL DEFAULT 0,  -- pauses > 5s that were recovered
    intensity       TEXT NOT NULL       -- 'gentle' | 'normal' | 'brutal'
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
