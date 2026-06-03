//! Local SQLite session store (rusqlite, bundled).
//!
//! Stores only counts and timestamps — the prose lives in the webview DOM and
//! never reaches Rust. The schema is embedded via [`include_str!`] and applied
//! idempotently on open.

use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::Serialize;

use crate::decay::Intensity;
use crate::error::{Error, Result};

/// Embedded DDL applied on every open (all statements are `IF NOT EXISTS`).
const SCHEMA: &str = include_str!("schema.sql");

/// Aggregate session statistics surfaced to the frontend (Phase 3 stats panel).
#[derive(Debug, Clone, Serialize)]
pub struct SessionStats {
    pub session_id: i64,
    pub started_at: i64,
    pub word_count: i64,
    pub decay_events: i64,
    pub intensity: String,
}

/// Owns the SQLite connection and the session/keystroke/decay tables.
pub struct SessionStore {
    conn: Connection,
}

impl SessionStore {
    /// Open (creating parent dirs) and migrate the database at `path`.
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        Self::from_connection(Connection::open(path)?)
    }

    /// In-memory store for tests.
    pub fn open_in_memory() -> Result<Self> {
        Self::from_connection(Connection::open_in_memory()?)
    }

    fn from_connection(conn: Connection) -> Result<Self> {
        conn.pragma_update(None, "foreign_keys", true)?;
        conn.execute_batch(SCHEMA)?;
        Ok(Self { conn })
    }

    /// Insert a new active session and return its id.
    pub fn start_session(&self, intensity: Intensity, started_at: i64) -> Result<i64> {
        self.conn.execute(
            "INSERT INTO sessions (started_at, intensity) VALUES (?1, ?2)",
            (started_at, intensity.as_str()),
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Log a keystroke timestamp for a session.
    pub fn record_keystroke(&self, session_id: i64, ts: i64) -> Result<()> {
        self.conn.execute(
            "INSERT INTO keystrokes (session_id, ts) VALUES (?1, ?2)",
            (session_id, ts),
        )?;
        Ok(())
    }

    /// Update the persisted intensity for a session (set from the settings UI).
    pub fn set_intensity(&self, session_id: i64, intensity: Intensity) -> Result<()> {
        self.conn.execute(
            "UPDATE sessions SET intensity = ?1 WHERE id = ?2",
            (intensity.as_str(), session_id),
        )?;
        Ok(())
    }

    /// Close a session, stamping `ended_at` and the final word count.
    pub fn end_session(&self, session_id: i64, word_count: i64, ended_at: i64) -> Result<()> {
        self.conn.execute(
            "UPDATE sessions SET ended_at = ?1, word_count = ?2 WHERE id = ?3",
            (ended_at, word_count, session_id),
        )?;
        Ok(())
    }

    /// Read aggregate stats for a session.
    pub fn get_stats(&self, session_id: i64) -> Result<SessionStats> {
        let stats = self.conn.query_row(
            "SELECT id, started_at, word_count, decay_events, intensity
             FROM sessions WHERE id = ?1",
            [session_id],
            |row| {
                Ok(SessionStats {
                    session_id: row.get(0)?,
                    started_at: row.get(1)?,
                    word_count: row.get(2)?,
                    decay_events: row.get(3)?,
                    intensity: row.get(4)?,
                })
            },
        )?;
        Ok(stats)
    }

    /// Count keystroke rows for a session (verification helper + Phase 3 stats).
    pub fn keystroke_count(&self, session_id: i64) -> Result<i64> {
        let count = self.conn.query_row(
            "SELECT COUNT(*) FROM keystrokes WHERE session_id = ?1",
            [session_id],
            |row| row.get(0),
        )?;
        Ok(count)
    }
}

/// Default DB location: `~/.pressfield/pressfield.db`.
pub fn default_db_path() -> Result<PathBuf> {
    let home = std::env::var_os("HOME").ok_or(Error::MissingEnv("HOME"))?;
    Ok(Path::new(&home).join(".pressfield").join("pressfield.db"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_session_with_keystrokes() {
        let store = SessionStore::open_in_memory().expect("open in-memory store");
        let session_id = store
            .start_session(Intensity::Normal, 1_000)
            .expect("start session");

        for ts in [1_100, 1_200, 1_300] {
            store
                .record_keystroke(session_id, ts)
                .expect("record keystroke");
        }

        store
            .end_session(session_id, 0, 2_000)
            .expect("end session");

        let stats = store.get_stats(session_id).expect("get stats");
        assert_eq!(stats.session_id, session_id);
        assert_eq!(stats.word_count, 0);
        assert_eq!(stats.decay_events, 0);
        assert_eq!(stats.intensity, "normal");
        assert_eq!(store.keystroke_count(session_id).expect("count"), 3);
    }

    #[test]
    fn keystrokes_cascade_delete_with_session() {
        let store = SessionStore::open_in_memory().expect("open");
        let id = store.start_session(Intensity::Brutal, 0).expect("start");
        store.record_keystroke(id, 1).expect("keystroke");
        store
            .conn
            .execute("DELETE FROM sessions WHERE id = ?1", [id])
            .expect("delete session");
        // FK pragma is on → keystrokes cascade away with the session.
        assert_eq!(store.keystroke_count(id).expect("count"), 0);
    }

    #[test]
    fn set_intensity_updates_the_session_row() {
        let store = SessionStore::open_in_memory().expect("open");
        let id = store
            .start_session(Intensity::Normal, 0)
            .expect("start session");
        store
            .set_intensity(id, Intensity::Brutal)
            .expect("set intensity");
        assert_eq!(store.get_stats(id).expect("stats").intensity, "brutal");
    }

    #[test]
    fn schema_reapplies_without_error() {
        let store = SessionStore::open_in_memory().expect("open");
        store.conn.execute_batch(SCHEMA).expect("re-apply schema");
    }
}
