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

use commands::{now_ms, ActiveDocument, ActiveSession};
use decay::Intensity;
use idle_timer::IdleTimer;
use session_store::{default_db_path, SessionStore};

/// SQLite key for the global hardcore-mode flag.
const HARDCORE_KEY: &str = "hardcore";

/// Build and run the Tauri application.
pub fn run() -> anyhow::Result<()> {
    tauri::Builder::default()
        .setup(|app| {
            // Open the store, run migrations (idempotent), then resolve the
            // document this launch opens into and start its session.
            let store = SessionStore::open(&default_db_path()?)?;
            store.apply_migration()?;
            let document_id = store.resolve_active_document()?;
            let session_id =
                store.start_session_for_document(Intensity::Normal, now_ms(), document_id)?;

            // Restore the persisted hardcore flag so the timer starts in the
            // correct state without requiring a UI interaction on launch.
            let hardcore_enabled = store
                .get_setting(HARDCORE_KEY)?
                .map(|v| v == "true")
                .unwrap_or(false);

            // Spawn the decay clock; it emits `decay-update` at 10 Hz and,
            // when hardcore is on at full decay, `decay-bite` at the cadence.
            let timer = Arc::new(IdleTimer::new(Intensity::Normal));
            timer.set_hardcore(hardcore_enabled);
            idle_timer::spawn(app.handle().clone(), timer.clone());

            app.manage(timer);
            app.manage(Mutex::new(store));
            app.manage(ActiveSession(session_id));
            app.manage(ActiveDocument(document_id));
            Ok(())
        })
        .on_window_event({
            // Wire window focus/blur → timer.set_focused so the hardcore pause
            // logic tracks whether the app window is in the foreground.
            // We clone the app handle; the timer is retrieved from managed state.
            |window, event| {
                if let tauri::WindowEvent::Focused(focused) = event {
                    match window.app_handle().try_state::<Arc<IdleTimer>>() {
                        Some(timer) => timer.set_focused(*focused),
                        // Before `manage(timer)` commits during setup the state
                        // is absent; log rather than silently drop the event so a
                        // missed pause-on-blur is observable. Default `focused =
                        // true` keeps the pre-setup state safe.
                        None => {
                            eprintln!("focus event dropped: IdleTimer not yet in managed state")
                        }
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::record_keystroke,
            commands::get_active_session_id,
            commands::get_stats,
            commands::set_intensity,
            commands::end_session,
            commands::get_recent_sessions,
            commands::create_document,
            commands::get_document,
            commands::save_document,
            commands::rename_document,
            commands::delete_document,
            commands::list_documents,
            commands::get_active_document,
            commands::start_document_session,
            commands::get_recent_document_sessions,
            commands::set_hardcore,
            commands::get_hardcore
        ])
        .run(tauri::generate_context!())
        .map_err(|e| anyhow::anyhow!("tauri runtime error: {e}"))?;
    Ok(())
}
