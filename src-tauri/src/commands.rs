//! Tauri command handlers — the IPC surface exposed to the webview.
//!
//! Argument keys arrive camelCase from JS and map to these snake_case params
//! (Tauri default). Errors are [`crate::error::Error`], serialized as strings.

use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::State;

use crate::error::{Error, Result};
use crate::idle_timer::IdleTimer;
use crate::session_store::{SessionStats, SessionStore};

/// The session opened when the app launched, held in Tauri managed state.
pub struct ActiveSession(pub i64);

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
#[tauri::command]
pub fn record_keystroke(
    session_id: i64,
    timer: State<'_, Arc<IdleTimer>>,
    store: State<'_, Mutex<SessionStore>>,
) -> Result<()> {
    timer.reset();
    let store = store.lock().map_err(|_| Error::LockPoisoned)?;
    store.record_keystroke(session_id, now_ms())
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
