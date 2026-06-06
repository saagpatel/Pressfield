//! The idle clock: a lock-free counter the decay state machine reads.
//!
//! A background thread ticks every 100 ms, advancing `ms_idle` and emitting a
//! [`DecayUpdate`] on the `decay-update` event. Any keystroke calls
//! [`IdleTimer::reset`], zeroing the counter so the next emit carries level 0.
//!
//! Hardcore mode (v2 Arc 2) adds two extra behaviours:
//! - Pause on window blur: when `focused = false` and `hardcore = true`, the
//!   tick thread does NOT advance `ms_idle` (resume-not-reset on refocus).
//! - Bite cadence: once `level ≥ 1.0` and `hardcore && focused`, the thread
//!   accumulates `ms_since_bite`; each time it crosses [`Intensity::bite_cadence_ms`]
//!   a `decay-bite` event is emitted and the accumulator wraps by the cadence so
//!   ticks land cleanly even under scheduler jitter.

use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Emitter};

use crate::decay::{decay_level, DecayBite, DecayUpdate, Intensity, DECAY_BITE_EVENT};

/// Emit cadence for the decay clock (10 Hz).
pub const TICK_MS: u64 = 100;

/// Event name carrying [`DecayUpdate`] payloads to the webview.
pub const DECAY_EVENT: &str = "decay-update";

/// Lock-free idle counter shared between the tick thread and command handlers.
///
/// `intensity` is an [`AtomicU8`] (encoded via [`Intensity::as_u8`]) so the
/// `set_intensity` command can retune the decay rate from the webview thread
/// without locking the tick thread.
///
/// `hardcore` and `focused` are [`AtomicBool`] fields so `set_hardcore` and the
/// window-focus callback can flip them from any thread without locking.
pub struct IdleTimer {
    ms_idle: AtomicU64,
    intensity: AtomicU8,
    hardcore: AtomicBool,
    focused: AtomicBool,
}

impl IdleTimer {
    pub fn new(intensity: Intensity) -> Self {
        Self {
            ms_idle: AtomicU64::new(0),
            intensity: AtomicU8::new(intensity.as_u8()),
            hardcore: AtomicBool::new(false),
            focused: AtomicBool::new(true), // assume focused at launch
        }
    }

    /// Zero the idle counter — called on every keystroke.
    ///
    /// `SeqCst` keeps the reset's visibility to the tick thread unambiguous;
    /// at 10 Hz on a single counter the ordering cost is immeasurable.
    pub fn reset(&self) {
        self.ms_idle.store(0, Ordering::SeqCst);
    }

    /// Retune the decay intensity; the next emitted snapshot reflects it.
    pub fn set_intensity(&self, intensity: Intensity) {
        self.intensity.store(intensity.as_u8(), Ordering::SeqCst);
    }

    /// Current intensity; an unrecognised tag (impossible via `set_intensity`)
    /// falls back to `Normal` rather than panicking. Read by `start_document_session`
    /// so a session started on a document switch inherits the live decay rate.
    pub fn intensity(&self) -> Intensity {
        Intensity::from_u8(self.intensity.load(Ordering::SeqCst)).unwrap_or(Intensity::Normal)
    }

    /// Enable or disable hardcore mode (toggle from the settings panel).
    pub fn set_hardcore(&self, enabled: bool) {
        self.hardcore.store(enabled, Ordering::SeqCst);
    }

    /// Whether hardcore mode is currently active.
    pub fn hardcore(&self) -> bool {
        self.hardcore.load(Ordering::SeqCst)
    }

    /// Update the window-focus state. Called from the `on_window_event` handler.
    /// When `focused = false` and hardcore is on, the tick thread pauses the
    /// idle clock (resume-not-reset: time resumes on refocus).
    pub fn set_focused(&self, focused: bool) {
        self.focused.store(focused, Ordering::SeqCst);
    }

    /// Whether the app window is currently focused.
    pub fn focused(&self) -> bool {
        self.focused.load(Ordering::SeqCst)
    }

    /// Advance the counter by `dt_ms` (only if not paused) and return the
    /// resulting snapshot.
    ///
    /// Pauses when `hardcore && !focused` — the idle clock freezes on blur so
    /// decay does not progress while the user is away from the app's window.
    /// When hardcore is OFF, blur has no effect (v1/Arc-1 behaviour preserved).
    pub fn advance(&self, dt_ms: u64) -> DecayUpdate {
        let hardcore = self.hardcore.load(Ordering::SeqCst);
        let focused = self.focused.load(Ordering::SeqCst);
        let ms_idle = if hardcore && !focused {
            // Paused: return current state without advancing the clock.
            self.ms_idle.load(Ordering::SeqCst)
        } else {
            self.ms_idle.fetch_add(dt_ms, Ordering::SeqCst) + dt_ms
        };
        self.snapshot_at(ms_idle)
    }

    /// Current snapshot without advancing the clock.
    pub fn snapshot(&self) -> DecayUpdate {
        self.snapshot_at(self.ms_idle.load(Ordering::SeqCst))
    }

    fn snapshot_at(&self, ms_idle: u64) -> DecayUpdate {
        let intensity = self.intensity();
        DecayUpdate {
            level: decay_level(ms_idle, intensity),
            ms_idle,
            intensity,
        }
    }
}

/// Spawn the 100 ms tick thread that emits `decay-update` (and, in hardcore
/// mode at full decay, `decay-bite`) on `app`.
pub fn spawn(app: AppHandle, timer: Arc<IdleTimer>) {
    thread::spawn(move || {
        // Emit a crisp baseline immediately so the UI has state before tick 1.
        emit_update(&app, timer.snapshot());
        // Thread-local bite accumulator: ms spent at full decay this cadence.
        let mut ms_since_bite: u64 = 0;
        // Monotonically-increasing sequence number for bite events.
        let mut bite_seq: u64 = 0;
        loop {
            thread::sleep(Duration::from_millis(TICK_MS));
            let update = timer.advance(TICK_MS);
            emit_update(&app, update.clone());

            // Hardcore bite logic: only when hardcore on, window focused, and
            // fully decayed (level ≥ 1.0). When any condition is absent, reset
            // the accumulator so ticks don't carry over from a non-bite window.
            let hardcore = timer.hardcore.load(Ordering::SeqCst);
            let focused = timer.focused.load(Ordering::SeqCst);
            if hardcore && focused && update.level >= 1.0 {
                ms_since_bite += TICK_MS;
                let cadence = timer.intensity().bite_cadence_ms();
                if ms_since_bite >= cadence {
                    // Wrap by cadence rather than reset to zero so jitter
                    // doesn't cause double-fire on slow ticks.
                    ms_since_bite = ms_since_bite.saturating_sub(cadence);
                    bite_seq += 1;
                    emit_bite(&app, DecayBite { seq: bite_seq });
                }
            } else {
                // Not in bite-eligible state: clear the accumulator so the
                // cadence window starts fresh next time we enter full decay.
                ms_since_bite = 0;
            }
        }
    });
}

fn emit_update(app: &AppHandle, update: DecayUpdate) {
    if let Err(err) = app.emit(DECAY_EVENT, update) {
        eprintln!("failed to emit {DECAY_EVENT}: {err}");
    }
}

fn emit_bite(app: &AppHandle, bite: DecayBite) {
    if let Err(err) = app.emit(DECAY_BITE_EVENT, bite) {
        eprintln!("failed to emit {DECAY_BITE_EVENT}: {err}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn advance_increments_by_delta() {
        let timer = IdleTimer::new(Intensity::Normal);
        assert_eq!(timer.advance(100).ms_idle, 100);
        assert_eq!(timer.advance(100).ms_idle, 200);
    }

    #[test]
    fn reset_zeroes_the_counter() {
        let timer = IdleTimer::new(Intensity::Normal);
        timer.advance(500);
        timer.reset();
        let snap = timer.snapshot();
        assert_eq!(snap.ms_idle, 0);
        assert_eq!(snap.level, 0.0);
    }

    #[test]
    fn advance_reports_decay_level() {
        let timer = IdleTimer::new(Intensity::Normal);
        // 2500ms is half of normal's 5000ms window → t=0.5 → t²=0.25 quadratic.
        assert_eq!(timer.advance(2_500).level, 0.25);
    }

    #[test]
    fn snapshot_does_not_advance() {
        let timer = IdleTimer::new(Intensity::Brutal);
        timer.advance(300);
        assert_eq!(timer.snapshot().ms_idle, 300);
        assert_eq!(timer.snapshot().ms_idle, 300);
    }

    #[test]
    fn set_intensity_retunes_the_window() {
        let timer = IdleTimer::new(Intensity::Brutal);
        timer.advance(2_000);
        // 2000ms is brutal's full window → full decay.
        assert_eq!(timer.snapshot().level, 1.0);

        timer.set_intensity(Intensity::Gentle);
        let snap = timer.snapshot();
        assert_eq!(snap.intensity, Intensity::Gentle);
        // Same 2000ms is a quarter of gentle's 8000ms window → t=0.25 → t²=0.0625.
        assert!((snap.level - 0.0625).abs() < 1e-6);
    }

    // ── Hardcore: pause-on-blur ───────────────────────────────────────────────

    #[test]
    fn hardcore_pauses_clock_on_blur() {
        let timer = IdleTimer::new(Intensity::Normal);
        timer.set_hardcore(true);
        timer.advance(1_000); // focused=true by default — clock advances
        assert_eq!(timer.snapshot().ms_idle, 1_000);

        timer.set_focused(false); // blur → pause
        timer.advance(500); // these ticks must NOT advance the clock
        timer.advance(500);
        assert_eq!(
            timer.snapshot().ms_idle,
            1_000,
            "blur must freeze the idle clock when hardcore is on"
        );

        timer.set_focused(true); // refocus → resume
        timer.advance(200);
        assert_eq!(
            timer.snapshot().ms_idle,
            1_200,
            "clock resumes (not resets) after refocus"
        );
    }

    #[test]
    fn blur_does_not_pause_when_hardcore_off() {
        let timer = IdleTimer::new(Intensity::Normal);
        // hardcore defaults to false
        timer.advance(1_000);
        timer.set_focused(false); // blur should have no effect
        timer.advance(500);
        assert_eq!(
            timer.snapshot().ms_idle,
            1_500,
            "blur must not pause when hardcore is off"
        );
    }

    #[test]
    fn set_hardcore_toggles_the_flag() {
        let timer = IdleTimer::new(Intensity::Normal);
        assert!(!timer.hardcore(), "off by default");
        timer.set_hardcore(true);
        assert!(timer.hardcore());
        timer.set_hardcore(false);
        assert!(!timer.hardcore());
    }

    #[test]
    fn focused_defaults_true() {
        let timer = IdleTimer::new(Intensity::Normal);
        assert!(timer.focused(), "window assumed focused at launch");
    }

    // ── Hardcore: cadence math (tick-level, no AppHandle needed) ─────────────
    //
    // The bite emission logic lives in the spawn() closure and therefore needs an
    // AppHandle to test end-to-end. What we can unit-test here is the pure math:
    // does `ms_since_bite` cross the cadence at the expected tick count?

    #[test]
    fn bite_cadence_brutal_fires_after_ten_ticks() {
        // Brutal cadence = 1000ms, tick = 100ms → fire after 10 ticks.
        let cadence = Intensity::Brutal.bite_cadence_ms();
        let mut acc: u64 = 0;
        let mut fires = 0u64;
        for _ in 0..30 {
            acc += TICK_MS;
            if acc >= cadence {
                acc = acc.saturating_sub(cadence);
                fires += 1;
            }
        }
        // 30 ticks × 100ms = 3000ms / 1000ms cadence = 3 fires.
        assert_eq!(fires, 3);
    }

    #[test]
    fn bite_cadence_gentle_fires_after_thirty_ticks() {
        // Gentle cadence = 3000ms, tick = 100ms → fire after 30 ticks.
        let cadence = Intensity::Gentle.bite_cadence_ms();
        let mut acc: u64 = 0;
        let mut fires = 0u64;
        for _ in 0..90 {
            acc += TICK_MS;
            if acc >= cadence {
                acc = acc.saturating_sub(cadence);
                fires += 1;
            }
        }
        // 90 ticks × 100ms = 9000ms / 3000ms cadence = 3 fires.
        assert_eq!(fires, 3);
    }

    #[test]
    fn accumulator_resets_when_level_drops_below_full() {
        // When the level < 1.0 (e.g. after a keystroke), ms_since_bite should
        // reset so partial accumulation doesn't carry into the next full-decay
        // window. This is the logic in the else branch of spawn(); here we verify
        // the same arithmetic inline.
        let mut ms_since_bite: u64 = 500; // half-accumulated
        let level: f32 = 0.5; // not at full decay
        if !(level >= 1.0) {
            ms_since_bite = 0;
        }
        assert_eq!(
            ms_since_bite, 0,
            "accumulator must clear when not at full decay"
        );
    }
}
