//! Local SQLite session store (rusqlite, bundled).
//!
//! v1 stored only counts and timestamps. v2 (Phase 4) adds named documents with
//! prose bodies in the `documents` table; sessions grow a `document_id` FK added
//! via a `PRAGMA user_version`-gated migration. The base schema is embedded via
//! [`include_str!`] and applied idempotently on every open.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::Connection;
use serde::Serialize;

use crate::decay::Intensity;
use crate::error::{Error, Result};

/// Unix epoch milliseconds, clamped to `i64::MAX`. Returns 0 if the system
/// clock predates 1970 (practically impossible, but avoids a panic).
fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(0)
}

/// Embedded DDL applied on every open (all statements are `IF NOT EXISTS`).
const SCHEMA: &str = include_str!("schema.sql");

/// The schema version this code targets. Migrations gate on `PRAGMA user_version`.
const TARGET_SCHEMA_VERSION: i64 = 3;
const SQLITE_BUSY_TIMEOUT: Duration = Duration::from_secs(5);

/// Aggregate session statistics surfaced to the frontend (Phase 3 stats panel).
#[derive(Debug, Clone, Serialize)]
pub struct SessionStats {
    pub session_id: i64,
    pub started_at: i64,
    pub word_count: i64,
    pub decay_events: i64,
    pub intensity: String,
    /// Set after the v1→v2 migration; `None` for sessions created before migration.
    pub document_id: Option<i64>,
}

/// Full document record including the prose body.
#[derive(Debug, Clone, Serialize)]
pub struct Document {
    pub id: i64,
    pub name: String,
    pub body: String,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Lightweight document descriptor for the list/palette view (no body).
#[derive(Debug, Clone, Serialize)]
pub struct DocumentMeta {
    pub id: i64,
    pub name: String,
    pub created_at: i64,
    pub updated_at: i64,
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
        Self::from_connection(Connection::open(path)?, true)
    }

    /// In-memory store for tests.
    pub fn open_in_memory() -> Result<Self> {
        Self::from_connection(Connection::open_in_memory()?, false)
    }

    fn from_connection(conn: Connection, enable_wal: bool) -> Result<Self> {
        conn.pragma_update(None, "foreign_keys", true)?;
        conn.busy_timeout(SQLITE_BUSY_TIMEOUT)?;
        if enable_wal {
            conn.pragma_update(None, "journal_mode", "WAL")?;
        }
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

    /// Record a recovered decay event — a pause that crossed the threshold and
    /// was typed back out of. Inserts the event row and bumps the session's
    /// running `decay_events` count (the value surfaced by [`Self::get_stats`]).
    pub fn record_decay_event(
        &self,
        session_id: i64,
        started_at: i64,
        recovered_at: i64,
        peak_level: f32,
    ) -> Result<()> {
        // Insert + counter bump in one transaction so a mid-write failure can't
        // leave the event row and the session's running count out of sync.
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO decay_events (session_id, started_at, recovered_at, peak_level)
             VALUES (?1, ?2, ?3, ?4)",
            (session_id, started_at, recovered_at, peak_level as f64),
        )?;
        tx.execute(
            "UPDATE sessions SET decay_events = decay_events + 1 WHERE id = ?1",
            [session_id],
        )?;
        tx.commit()?;
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
            "SELECT id, started_at, word_count, decay_events, intensity, document_id
             FROM sessions WHERE id = ?1",
            [session_id],
            |row| {
                Ok(SessionStats {
                    session_id: row.get(0)?,
                    started_at: row.get(1)?,
                    word_count: row.get(2)?,
                    decay_events: row.get(3)?,
                    intensity: row.get(4)?,
                    document_id: row.get(5)?,
                })
            },
        )?;
        Ok(stats)
    }

    /// Return up to `limit` sessions, newest first, for the history table.
    pub fn get_recent_sessions(&self, limit: i64) -> Result<Vec<SessionStats>> {
        self.query_sessions(
            "SELECT id, started_at, word_count, decay_events, intensity, document_id
             FROM sessions ORDER BY started_at DESC LIMIT ?1",
            rusqlite::params![limit],
        )
    }

    /// Return up to `limit` sessions for a specific document, newest first.
    pub fn get_recent_sessions_for_document(
        &self,
        document_id: i64,
        limit: i64,
    ) -> Result<Vec<SessionStats>> {
        self.query_sessions(
            "SELECT id, started_at, word_count, decay_events, intensity, document_id
             FROM sessions WHERE document_id = ?1 ORDER BY started_at DESC LIMIT ?2",
            rusqlite::params![document_id, limit],
        )
    }

    /// Shared row-mapper for session queries that include the document_id column.
    fn query_sessions(
        &self,
        sql: &str,
        params: &[&dyn rusqlite::ToSql],
    ) -> Result<Vec<SessionStats>> {
        let mut stmt = self.conn.prepare(sql)?;
        let rows = stmt.query_map(params, |row| {
            Ok(SessionStats {
                session_id: row.get(0)?,
                started_at: row.get(1)?,
                word_count: row.get(2)?,
                decay_events: row.get(3)?,
                intensity: row.get(4)?,
                document_id: row.get::<_, Option<i64>>(5)?,
            })
        })?;
        let mut sessions = Vec::new();
        for row in rows {
            sessions.push(row?);
        }
        Ok(sessions)
    }

    // ── Phase 4: Documents ────────────────────────────────────────────────────

    /// Apply schema migrations (idempotent; gates on `PRAGMA user_version`).
    ///
    /// v1→v2: adds `sessions.document_id` (FK → documents), seeds an "Untitled"
    /// document, backfills existing sessions.
    ///
    /// v2→v3: creates the `settings` key/value table for global app settings
    /// (e.g. the hardcore-mode flag).
    pub fn apply_migration(&self) -> Result<()> {
        let version: i64 = self
            .conn
            .pragma_query_value(None, "user_version", |row| row.get(0))?;
        if version >= TARGET_SCHEMA_VERSION {
            return Ok(());
        }

        let tx = self.conn.unchecked_transaction()?;

        // ── v1 → v2 ──────────────────────────────────────────────────────────
        if version < 2 {
            let now = now_ms();
            // Add the column only if it doesn't already exist (fresh DBs created from
            // the v2 schema already have it; only real on-disk v1 databases are missing
            // it). Propagate a probe failure rather than defaulting to "absent" — a
            // swallowed error there would issue a duplicate ALTER on a v2 DB.
            let column_count: i64 = tx.query_row(
                "SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = 'document_id'",
                [],
                |row| row.get(0),
            )?;
            if column_count == 0 {
                tx.execute_batch(
                    "ALTER TABLE sessions ADD COLUMN document_id INTEGER REFERENCES documents(id)",
                )?;
            }
            // Create the default "Untitled" document.
            tx.execute(
                "INSERT INTO documents (name, body, created_at, updated_at) VALUES ('Untitled', '', ?1, ?1)",
                [now],
            )?;
            let untitled_id = tx.last_insert_rowid();
            // Backfill all existing sessions to the Untitled document.
            tx.execute(
                "UPDATE sessions SET document_id = ?1 WHERE document_id IS NULL",
                [untitled_id],
            )?;
        }

        // ── v2 → v3 ──────────────────────────────────────────────────────────
        // Create the settings table if it doesn't exist yet. On a fresh DB the
        // DDL in schema.sql already ran CREATE TABLE IF NOT EXISTS, so this is
        // purely a version-bump for databases that existed at v2.
        if version < 3 {
            tx.execute_batch(
                "CREATE TABLE IF NOT EXISTS settings (
                    key   TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                )",
            )?;
        }

        tx.pragma_update(None, "user_version", TARGET_SCHEMA_VERSION)?;
        tx.commit()?;
        Ok(())
    }

    // ── Phase 7: Settings (global key/value store) ────────────────────────────

    /// Read a setting by key; returns `None` if the key is absent.
    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let mut stmt = self
            .conn
            .prepare("SELECT value FROM settings WHERE key = ?1")?;
        let mut rows = stmt.query([key])?;
        match rows.next()? {
            Some(row) => Ok(Some(row.get(0)?)),
            None => Ok(None),
        }
    }

    /// Upsert a setting (insert or replace on key conflict).
    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )?;
        Ok(())
    }

    /// Insert a new active session bound to a specific document.
    pub fn start_session_for_document(
        &self,
        intensity: Intensity,
        started_at: i64,
        document_id: i64,
    ) -> Result<i64> {
        self.conn.execute(
            "INSERT INTO sessions (started_at, intensity, document_id) VALUES (?1, ?2, ?3)",
            (started_at, intensity.as_str(), document_id),
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Create a new document and return its id.
    pub fn create_document(&self, name: &str) -> Result<i64> {
        self.conn.execute(
            "INSERT INTO documents (name, body, created_at, updated_at) VALUES (?1, '', ?2, ?2)",
            (name, now_ms()),
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Fetch the full document record (including body).
    pub fn get_document(&self, id: i64) -> Result<Document> {
        let doc = self.conn.query_row(
            "SELECT id, name, body, created_at, updated_at FROM documents WHERE id = ?1",
            [id],
            |row| {
                Ok(Document {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    body: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            },
        )?;
        Ok(doc)
    }

    /// Persist the prose body for a document and advance its `updated_at`.
    pub fn save_document(&self, id: i64, body: &str, updated_at: i64) -> Result<()> {
        self.conn.execute(
            "UPDATE documents SET body = ?1, updated_at = ?2 WHERE id = ?3",
            (body, updated_at, id),
        )?;
        Ok(())
    }

    /// Rename a document.
    pub fn rename_document(&self, id: i64, name: &str) -> Result<()> {
        self.conn
            .execute("UPDATE documents SET name = ?1 WHERE id = ?2", (name, id))?;
        Ok(())
    }

    /// Delete a document by id.
    ///
    /// Sessions that reference this document will have their `document_id` set
    /// to NULL (no cascade — the session history is preserved).
    pub fn delete_document(&self, id: i64) -> Result<()> {
        // Null out FK references first (the FK is NO ACTION, so the DELETE would
        // be rejected otherwise), then delete — both in one transaction so a
        // mid-write failure can't leave sessions detached from a surviving doc.
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "UPDATE sessions SET document_id = NULL WHERE document_id = ?1",
            [id],
        )?;
        tx.execute("DELETE FROM documents WHERE id = ?1", [id])?;
        tx.commit()?;
        Ok(())
    }

    /// Return all documents, ordered by `updated_at` descending (most-recent first).
    pub fn list_documents(&self) -> Result<Vec<DocumentMeta>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, created_at, updated_at FROM documents ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(DocumentMeta {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })?;
        let mut docs = Vec::new();
        for row in rows {
            docs.push(row?);
        }
        Ok(docs)
    }

    /// Resolve the document to open on launch: the most-recently-updated one,
    /// seeding a default "Untitled" if the store is empty (fresh install).
    ///
    /// Call after [`Self::apply_migration`], which guarantees a v2 schema and —
    /// for migrated databases — an already-seeded "Untitled". On a never-migrated
    /// fresh DB this is the seam that creates the first document.
    pub fn resolve_active_document(&self) -> Result<i64> {
        match self.list_documents()?.first() {
            Some(doc) => Ok(doc.id),
            None => self.create_document("Untitled"),
        }
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
    fn record_decay_event_inserts_and_increments_count() {
        let store = SessionStore::open_in_memory().expect("open");
        let id = store.start_session(Intensity::Normal, 0).expect("start");
        assert_eq!(store.get_stats(id).expect("stats").decay_events, 0);

        store
            .record_decay_event(id, 0, 6_000, 0.9)
            .expect("record event");
        store
            .record_decay_event(id, 7_000, 13_000, 1.0)
            .expect("record event");

        // Both writes landed: the session counter AND the event rows themselves.
        assert_eq!(store.get_stats(id).expect("stats").decay_events, 2);
        let event_rows: i64 = store
            .conn
            .query_row(
                "SELECT COUNT(*) FROM decay_events WHERE session_id = ?1",
                [id],
                |row| row.get(0),
            )
            .expect("count event rows");
        assert_eq!(event_rows, 2);
    }

    #[test]
    fn get_recent_sessions_returns_newest_first() {
        let store = SessionStore::open_in_memory().expect("open");
        let a = store.start_session(Intensity::Gentle, 1_000).expect("a");
        let b = store.start_session(Intensity::Brutal, 2_000).expect("b");
        store.end_session(a, 5, 1_500).expect("end a");
        store.end_session(b, 9, 2_500).expect("end b");

        let recent = store.get_recent_sessions(10).expect("recent");
        assert_eq!(recent.len(), 2);
        // Newest started_at first.
        assert_eq!(recent[0].session_id, b);
        assert_eq!(recent[0].word_count, 9);
        assert_eq!(recent[1].session_id, a);
        assert_eq!(recent[1].word_count, 5);
    }

    #[test]
    fn schema_reapplies_without_error() {
        let store = SessionStore::open_in_memory().expect("open");
        store.conn.execute_batch(SCHEMA).expect("re-apply schema");
    }

    #[test]
    fn file_backed_store_enables_wal_and_busy_timeout() {
        let path = std::env::temp_dir().join(format!(
            "pressfield-sqlite-config-{}-{}.db",
            std::process::id(),
            now_ms()
        ));

        let store = SessionStore::open(&path).expect("open file-backed store");

        let journal_mode: String = store
            .conn
            .pragma_query_value(None, "journal_mode", |row| row.get(0))
            .expect("journal_mode");
        let busy_timeout_ms: i64 = store
            .conn
            .pragma_query_value(None, "busy_timeout", |row| row.get(0))
            .expect("busy_timeout");

        assert_eq!(journal_mode.to_ascii_lowercase(), "wal");
        assert_eq!(busy_timeout_ms, SQLITE_BUSY_TIMEOUT.as_millis() as i64);

        drop(store);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("db-wal"));
        let _ = std::fs::remove_file(path.with_extension("db-shm"));
    }

    // ── Phase 4: Documents ────────────────────────────────────────────────────

    #[test]
    fn create_document_returns_unique_ids() {
        let store = SessionStore::open_in_memory().expect("open");
        let a = store.create_document("Alpha").expect("create Alpha");
        let b = store.create_document("Beta").expect("create Beta");
        assert_ne!(a, b, "each document gets a distinct id");
    }

    #[test]
    fn get_document_round_trips_name_and_body() {
        let store = SessionStore::open_in_memory().expect("open");
        let id = store.create_document("My Essay").expect("create");
        let doc = store.get_document(id).expect("get");
        assert_eq!(doc.id, id);
        assert_eq!(doc.name, "My Essay");
        assert_eq!(doc.body, "");
    }

    #[test]
    fn save_document_stores_body_and_bumps_updated_at() {
        let store = SessionStore::open_in_memory().expect("open");
        let id = store.create_document("Draft").expect("create");
        let t1 = store.get_document(id).expect("get before save").updated_at;

        store
            .save_document(id, "Hello prose", t1 + 1)
            .expect("save");

        let doc = store.get_document(id).expect("get after save");
        assert_eq!(doc.body, "Hello prose");
        assert!(doc.updated_at > t1, "updated_at must advance");
    }

    #[test]
    fn save_document_is_idempotent() {
        // Saving the same body twice is not an error; body round-trips correctly.
        let store = SessionStore::open_in_memory().expect("open");
        let id = store.create_document("Draft").expect("create");
        store.save_document(id, "prose", 1_000).expect("first save");
        store
            .save_document(id, "prose", 2_000)
            .expect("second save");
        let doc = store.get_document(id).expect("get");
        assert_eq!(doc.body, "prose");
        assert_eq!(doc.updated_at, 2_000);
    }

    #[test]
    fn rename_document_updates_name() {
        let store = SessionStore::open_in_memory().expect("open");
        let id = store.create_document("Old Name").expect("create");
        store.rename_document(id, "New Name").expect("rename");
        assert_eq!(store.get_document(id).expect("get").name, "New Name");
    }

    #[test]
    fn delete_document_removes_it() {
        let store = SessionStore::open_in_memory().expect("open");
        let id = store.create_document("Gone").expect("create");
        store.delete_document(id).expect("delete");
        let result = store.get_document(id);
        assert!(result.is_err(), "deleted document must not be retrievable");
    }

    #[test]
    fn list_documents_returns_all_newest_first() {
        let store = SessionStore::open_in_memory().expect("open");
        let a = store.create_document("Alpha").expect("a");
        let b = store.create_document("Beta").expect("b");
        // Make Beta more recently updated.
        store.save_document(b, "", 2_000).expect("save b");
        store.save_document(a, "", 1_000).expect("save a");

        let docs = store.list_documents().expect("list");
        assert_eq!(docs.len(), 2);
        // Newest updated_at first.
        assert_eq!(docs[0].id, b);
        assert_eq!(docs[1].id, a);
    }

    #[test]
    fn migration_backfills_null_document_id_sessions() {
        // The in-memory schema already carries `document_id` (it's the v2 DDL), so
        // this exercises the BACKFILL branch: a session inserted with a NULL
        // document_id (pre-migration) is repointed to the seeded Untitled doc.
        // The ALTER-TABLE branch is covered by the real-v1 test below.
        let store = SessionStore::open_in_memory().expect("open");
        let session_id = store
            .start_session(Intensity::Normal, 1_000)
            .expect("start session");

        store.apply_migration().expect("apply migration");

        let stats = store.get_stats(session_id).expect("get stats");
        assert!(
            stats.document_id.is_some(),
            "session must have a document_id after migration"
        );
    }

    #[test]
    fn migration_adds_column_on_real_v1_database() {
        // Genuinely simulate a v1 on-disk DB: strip the v2 column + seeding and
        // reset the schema version, so apply_migration runs the ALTER-TABLE path
        // (not just the backfill). This is the branch real upgrades depend on.
        let store = SessionStore::open_in_memory().expect("open");
        store
            .conn
            .execute_batch(
                "ALTER TABLE sessions DROP COLUMN document_id;
                 DELETE FROM documents;
                 PRAGMA user_version = 0;",
            )
            .expect("downgrade to v1 shape");
        let session_id = store
            .start_session(Intensity::Normal, 1_000)
            .expect("v1 session");

        store.apply_migration().expect("migrate");

        // The column was re-added via ALTER and the v1 session backfilled.
        let stats = store.get_stats(session_id).expect("stats");
        assert!(stats.document_id.is_some(), "v1 session backfilled");
        // Exactly one Untitled seeded — not zero, not two.
        let docs = store.list_documents().expect("list");
        assert_eq!(docs.len(), 1);
        assert_eq!(docs[0].name, "Untitled");
    }

    #[test]
    fn migration_is_idempotent() {
        // Calling apply_migration twice must not panic or return an error.
        let store = SessionStore::open_in_memory().expect("open");
        store.apply_migration().expect("first migration");
        store
            .apply_migration()
            .expect("second migration — must be no-op");
    }

    #[test]
    fn get_recent_sessions_filters_by_document() {
        let store = SessionStore::open_in_memory().expect("open");
        store.apply_migration().expect("migrate");

        let doc_a = store.create_document("A").expect("doc A");
        let doc_b = store.create_document("B").expect("doc B");

        let s1 = store
            .start_session_for_document(Intensity::Normal, 1_000, doc_a)
            .expect("session 1 doc A");
        let s2 = store
            .start_session_for_document(Intensity::Normal, 2_000, doc_b)
            .expect("session 2 doc B");
        let s3 = store
            .start_session_for_document(Intensity::Normal, 3_000, doc_a)
            .expect("session 3 doc A");

        let a_sessions = store
            .get_recent_sessions_for_document(doc_a, 10)
            .expect("sessions for A");
        let b_sessions = store
            .get_recent_sessions_for_document(doc_b, 10)
            .expect("sessions for B");

        assert_eq!(a_sessions.len(), 2, "doc A has 2 sessions");
        assert_eq!(b_sessions.len(), 1, "doc B has 1 session");
        // Within doc A, newest first.
        assert_eq!(a_sessions[0].session_id, s3);
        assert_eq!(a_sessions[1].session_id, s1);
        // doc B's single session.
        assert_eq!(b_sessions[0].session_id, s2);
    }

    #[test]
    fn resolve_active_document_creates_untitled_when_empty() {
        // A store with no documents (fresh install) resolves by seeding one.
        let store = SessionStore::open_in_memory().expect("open");
        assert_eq!(store.list_documents().expect("list").len(), 0);

        let id = store.resolve_active_document().expect("resolve");

        let docs = store.list_documents().expect("list");
        assert_eq!(docs.len(), 1, "exactly one seeded document");
        assert_eq!(docs[0].id, id);
        assert_eq!(store.get_document(id).expect("get").name, "Untitled");
    }

    #[test]
    fn resolve_active_document_returns_most_recently_updated() {
        // With existing documents, launch reopens the most-recently-touched one.
        let store = SessionStore::open_in_memory().expect("open");
        let a = store.create_document("A").expect("a");
        let b = store.create_document("B").expect("b");
        store.save_document(a, "", 1_000).expect("save a");
        store.save_document(b, "", 2_000).expect("save b"); // b is newer

        assert_eq!(store.resolve_active_document().expect("resolve"), b);

        // Resolving must not create a spurious extra document.
        assert_eq!(store.list_documents().expect("list").len(), 2);
    }

    // ── Phase 7: Settings (v2→v3 migration + key/value helpers) ─────────────

    #[test]
    fn settings_round_trip() {
        let store = SessionStore::open_in_memory().expect("open");
        store.apply_migration().expect("migrate");

        assert_eq!(
            store.get_setting("hardcore").expect("get absent"),
            None,
            "absent key returns None"
        );

        store.set_setting("hardcore", "true").expect("set");
        assert_eq!(
            store.get_setting("hardcore").expect("get present"),
            Some("true".into())
        );
    }

    #[test]
    fn settings_upsert_overwrites() {
        let store = SessionStore::open_in_memory().expect("open");
        store.apply_migration().expect("migrate");

        store.set_setting("hardcore", "false").expect("set false");
        store.set_setting("hardcore", "true").expect("set true");

        assert_eq!(
            store.get_setting("hardcore").expect("get"),
            Some("true".into()),
            "upsert must overwrite previous value"
        );
    }

    #[test]
    fn v2_to_v3_migration_creates_settings_table() {
        // Simulate a v2 database: apply schema (which includes settings DDL for
        // fresh DBs), then forcibly reset user_version to 2 so apply_migration
        // runs the v2→v3 branch on an already-configured schema.
        let store = SessionStore::open_in_memory().expect("open");
        store.apply_migration().expect("first migrate to v3");

        // Downgrade version to 2 to re-exercise the v2→v3 path.
        store
            .conn
            .pragma_update(None, "user_version", 2i64)
            .expect("set version to 2");

        store
            .apply_migration()
            .expect("v2→v3 must succeed on already-existing settings table");

        let ver: i64 = store
            .conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .expect("user_version");
        assert_eq!(ver, TARGET_SCHEMA_VERSION, "version bumped to v3");

        // Settings table is functional after the migration.
        store
            .set_setting("hardcore", "true")
            .expect("set after v2→v3");
        assert_eq!(
            store.get_setting("hardcore").expect("get"),
            Some("true".into())
        );
    }

    #[test]
    fn migration_runs_v1_through_to_v3_in_one_pass() {
        // A genuine v1 on-disk DB upgraded in a single apply_migration() call must
        // run BOTH the v1→v2 and v2→v3 branches: re-add document_id, seed/backfill
        // the Untitled document, AND create the settings table. This combined path
        // is newly exercised by P7 and was previously only covered one hop at a
        // time.
        let store = SessionStore::open_in_memory().expect("open");
        store
            .conn
            .execute_batch(
                "ALTER TABLE sessions DROP COLUMN document_id;
                 DELETE FROM documents;
                 DROP TABLE settings;
                 PRAGMA user_version = 0;",
            )
            .expect("downgrade to v1 shape");
        let session_id = store
            .start_session(Intensity::Normal, 1_000)
            .expect("v1 session");

        store.apply_migration().expect("migrate v1→v3");

        // Landed at v3.
        let ver: i64 = store
            .conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .expect("user_version");
        assert_eq!(
            ver, TARGET_SCHEMA_VERSION,
            "v1 DB migrated all the way to v3"
        );

        // v1→v2 effects: column re-added, v1 session backfilled, one Untitled.
        let stats = store.get_stats(session_id).expect("stats");
        assert!(
            stats.document_id.is_some(),
            "v1 session backfilled to a document"
        );
        let docs = store.list_documents().expect("list");
        assert_eq!(docs.len(), 1);
        assert_eq!(docs[0].name, "Untitled");

        // v2→v3 effect: settings table created and functional.
        store
            .set_setting("hardcore", "true")
            .expect("settings usable after v1→v3");
        assert_eq!(
            store.get_setting("hardcore").expect("get"),
            Some("true".into())
        );
    }

    #[test]
    fn migration_v3_is_idempotent() {
        // Running apply_migration twice on a v3 DB must be a no-op.
        let store = SessionStore::open_in_memory().expect("open");
        store.apply_migration().expect("first");
        store.apply_migration().expect("second — must not error");

        let ver: i64 = store
            .conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .expect("user_version");
        assert_eq!(ver, TARGET_SCHEMA_VERSION);
    }
}
