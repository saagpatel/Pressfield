//! Pressfield backend: the idle timer, decay state, and SQLite session store,
//! wired to the webview over Tauri IPC.
//!
//! Architecture (see IMPLEMENTATION-PLAN.md §3): a 100 ms thread advances the
//! [`idle_timer::IdleTimer`] and emits [`decay::DecayUpdate`] events; the
//! `record_keystroke` command resets that timer and logs to SQLite. The
//! frontend holds no decay state — it only consumes events.

pub mod commands;
pub mod decay;
pub mod error;
pub mod idle_timer;
pub mod session_store;

use std::sync::{Arc, Mutex};

use tauri::Manager;

use commands::{now_ms, ActiveSession};
use decay::Intensity;
use idle_timer::IdleTimer;
use session_store::{default_db_path, SessionStore};

/// Build and run the Tauri application.
pub fn run() -> anyhow::Result<()> {
    tauri::Builder::default()
        .setup(|app| {
            // Open the session store and start the session this launch belongs to.
            let store = SessionStore::open(&default_db_path()?)?;
            let session_id = store.start_session(Intensity::Normal, now_ms())?;

            // Spawn the decay clock; it emits `decay-update` at 10 Hz.
            let timer = Arc::new(IdleTimer::new(Intensity::Normal));
            idle_timer::spawn(app.handle().clone(), timer.clone());

            app.manage(timer);
            app.manage(Mutex::new(store));
            app.manage(ActiveSession(session_id));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::record_keystroke,
            commands::get_active_session_id,
            commands::get_stats,
            commands::set_intensity,
            commands::end_session,
            commands::get_recent_sessions
        ])
        .run(tauri::generate_context!())
        .map_err(|e| anyhow::anyhow!("tauri runtime error: {e}"))?;
    Ok(())
}
