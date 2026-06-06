//! Tauri command handlers — the IPC surface exposed to the webview.
//!
//! Argument keys arrive camelCase from JS and map to these snake_case params
//! (Tauri default). Errors are [`crate::error::Error`], serialized as strings.

use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::State;

use crate::decay::Intensity;
use crate::error::{Error, Result};
use crate::idle_timer::IdleTimer;
use crate::session_store::{Document, DocumentMeta, SessionStats, SessionStore};

/// The session opened when the app launched, held in Tauri managed state.
pub struct ActiveSession(pub i64);

/// The document open in the editor this launch, held in Tauri managed state.
/// The webview reads it via `get_active_document` to hydrate on startup and as
/// the target for autosave writes.
pub struct ActiveDocument(pub i64);

/// A pause longer than this (ms) is logged as a recovered decay event when the
/// next keystroke arrives — matches the schema's "pauses > 5s" definition.
const DECAY_EVENT_THRESHOLD_MS: u64 = 5_000;

/// If `ms_idle` crossed the decay-event threshold, return the
/// `(started_at, recovered_at)` window for the event that just recovered;
/// `None` for a sub-threshold pause. Pure so the rule is unit-testable.
fn recovered_decay_window(ms_idle: u64, now: i64) -> Option<(i64, i64)> {
    if ms_idle > DECAY_EVENT_THRESHOLD_MS {
        Some((now - ms_idle as i64, now))
    } else {
        None
    }
}

/// Unix epoch milliseconds; degrades to 0 if the clock predates 1970.
pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        // Clamp instead of a truncating `as i64`; epoch ms won't reach i64::MAX
        // for ~292M years, but the clamp removes the silent-truncation footgun.
        .map(|d| d.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(0)
}

/// Reset the idle timer and log a keystroke row for the given session.
///
/// If the pause before this keystroke crossed the decay-event threshold, this
/// keystroke is the recovery, so a decay event is recorded first. `peak_level`
/// is the pre-reset level — decay is monotonic over idle time, so the level at
/// recovery is the maximum the pause reached.
#[tauri::command]
pub fn record_keystroke(
    session_id: i64,
    timer: State<'_, Arc<IdleTimer>>,
    store: State<'_, Mutex<SessionStore>>,
) -> Result<()> {
    let before = timer.snapshot(); // capture idle state before reset zeroes it
    timer.reset();
    let now = now_ms();
    let store = store.lock().map_err(|_| Error::LockPoisoned)?;
    if let Some((started_at, recovered_at)) = recovered_decay_window(before.ms_idle, now) {
        store.record_decay_event(session_id, started_at, recovered_at, before.level)?;
    }
    store.record_keystroke(session_id, now)
}

/// Return the id of the session created at launch.
#[tauri::command]
pub fn get_active_session_id(active: State<'_, ActiveSession>) -> i64 {
    active.0
}

/// Read aggregate stats for a session.
#[tauri::command]
pub fn get_stats(session_id: i64, store: State<'_, Mutex<SessionStore>>) -> Result<SessionStats> {
    let store = store.lock().map_err(|_| Error::LockPoisoned)?;
    store.get_stats(session_id)
}

/// Retune decay intensity: update the live timer and persist it on the given
/// session. The webview passes the current session id (which changes when the
/// active document is switched), so the choice always lands on the live session.
#[tauri::command]
pub fn set_intensity(
    session_id: i64,
    intensity: Intensity,
    timer: State<'_, Arc<IdleTimer>>,
    store: State<'_, Mutex<SessionStore>>,
) -> Result<()> {
    // Persist first, then retune the live timer: if the DB write fails, the
    // timer is left untouched so the visible decay rate and the stored row stay
    // consistent (both old) rather than diverging.
    let store = store.lock().map_err(|_| Error::LockPoisoned)?;
    store.set_intensity(session_id, intensity)?;
    timer.set_intensity(intensity);
    Ok(())
}

/// Finalize a session, stamping its end time and final word count. Fired from
/// the webview when the window is closing.
#[tauri::command]
pub fn end_session(
    session_id: i64,
    word_count: i64,
    store: State<'_, Mutex<SessionStore>>,
) -> Result<()> {
    let store = store.lock().map_err(|_| Error::LockPoisoned)?;
    store.end_session(session_id, word_count, now_ms())
}

/// Return the most recent sessions (newest first) for the history table.
#[tauri::command]
pub fn get_recent_sessions(
    limit: i64,
    store: State<'_, Mutex<SessionStore>>,
) -> Result<Vec<SessionStats>> {
    let store = store.lock().map_err(|_| Error::LockPoisoned)?;
    store.get_recent_sessions(limit)
}

/// Return the most recent sessions for a specific document, newest first — the
/// per-document history the stats panel shows for the active document.
#[tauri::command]
pub fn get_recent_document_sessions(
    document_id: i64,
    limit: i64,
    store: State<'_, Mutex<SessionStore>>,
) -> Result<Vec<SessionStats>> {
    let store = store.lock().map_err(|_| Error::LockPoisoned)?;
    store.get_recent_sessions_for_document(document_id, limit)
}

// ── Phase 4: Document IPC surface ───────────────────────────────────────────
//
// Thin wrappers over the tested `SessionStore` document methods. Like the
// session commands above, the store method is the unit under test; these only
// lock managed state and forward. `save_document` stamps `updated_at` server-
// side (mirroring `end_session`) so the webview never owns the clock.

/// Create a new (empty) document and return its id.
#[tauri::command]
pub fn create_document(name: String, store: State<'_, Mutex<SessionStore>>) -> Result<i64> {
    let store = store.lock().map_err(|_| Error::LockPoisoned)?;
    store.create_document(&name)
}

/// Fetch a document's full record, including its prose body.
#[tauri::command]
pub fn get_document(id: i64, store: State<'_, Mutex<SessionStore>>) -> Result<Document> {
    let store = store.lock().map_err(|_| Error::LockPoisoned)?;
    store.get_document(id)
}

/// Persist a document's prose body; `updated_at` is stamped server-side.
#[tauri::command]
pub fn save_document(id: i64, body: String, store: State<'_, Mutex<SessionStore>>) -> Result<()> {
    let store = store.lock().map_err(|_| Error::LockPoisoned)?;
    store.save_document(id, &body, now_ms())
}

/// Rename a document.
#[tauri::command]
pub fn rename_document(id: i64, name: String, store: State<'_, Mutex<SessionStore>>) -> Result<()> {
    let store = store.lock().map_err(|_| Error::LockPoisoned)?;
    store.rename_document(id, &name)
}

/// Delete a document; its sessions are preserved with a NULL `document_id`.
#[tauri::command]
pub fn delete_document(id: i64, store: State<'_, Mutex<SessionStore>>) -> Result<()> {
    let store = store.lock().map_err(|_| Error::LockPoisoned)?;
    store.delete_document(id)
}

/// List all documents, most-recently-updated first (for the Cmd+O palette).
#[tauri::command]
pub fn list_documents(store: State<'_, Mutex<SessionStore>>) -> Result<Vec<DocumentMeta>> {
    let store = store.lock().map_err(|_| Error::LockPoisoned)?;
    store.list_documents()
}

/// Return the document the app opened this launch (id, name, body), so the
/// webview can hydrate the editor on startup before any keystroke.
#[tauri::command]
pub fn get_active_document(
    active: State<'_, ActiveDocument>,
    store: State<'_, Mutex<SessionStore>>,
) -> Result<Document> {
    let store = store.lock().map_err(|_| Error::LockPoisoned)?;
    store.get_document(active.0)
}

/// Start a fresh session bound to `document_id`, inheriting the live decay
/// intensity. Returned to the webview when switching documents (Phase 6); the
/// webview finalizes the outgoing session before calling this.
#[tauri::command]
pub fn start_document_session(
    document_id: i64,
    timer: State<'_, Arc<IdleTimer>>,
    store: State<'_, Mutex<SessionStore>>,
) -> Result<i64> {
    let store = store.lock().map_err(|_| Error::LockPoisoned)?;
    store.start_session_for_document(timer.intensity(), now_ms(), document_id)
}

// ── Phase 7: Hardcore mode ───────────────────────────────────────────────────

/// Enable or disable hardcore mode globally.
///
/// Persists the flag to `settings("hardcore")` first (so a crash between persist
/// and retune leaves the DB and the live timer consistent — both old value),
/// then retunes the live timer. Mirrors the `persist-then-retune` ordering used
/// by `set_intensity`.
#[tauri::command]
pub fn set_hardcore(
    enabled: bool,
    timer: State<'_, Arc<IdleTimer>>,
    store: State<'_, Mutex<SessionStore>>,
) -> Result<()> {
    let store = store.lock().map_err(|_| Error::LockPoisoned)?;
    store.set_setting("hardcore", if enabled { "true" } else { "false" })?;
    timer.set_hardcore(enabled);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sub_threshold_pause_records_no_event() {
        assert_eq!(recovered_decay_window(0, 10_000), None);
        assert_eq!(
            recovered_decay_window(DECAY_EVENT_THRESHOLD_MS, 10_000),
            None
        );
    }

    #[test]
    fn recovered_pause_yields_its_window() {
        // 6s pause recovered at t=10_000 → started 6s earlier.
        assert_eq!(recovered_decay_window(6_000, 10_000), Some((4_000, 10_000)));
    }
}
