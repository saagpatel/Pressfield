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
//!   accumulates toward [`Intensity::bite_cadence_ms`]; each time it crosses the
//!   cadence a `decay-bite` event is emitted and the remainder carries forward
//!   so ticks land cleanly under scheduler jitter.
//!
//! [`IdleTimer::tick`] derives both the pause decision and bite eligibility from
//! a single read of the `hardcore`/`focused` flags, so the two can never
//! disagree within one tick. The cadence arithmetic lives in the pure
//! [`advance_bite_accumulator`] free function, which the tests exercise directly.

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

/// The result of one clock tick: the snapshot to emit, plus whether this tick
/// is eligible to advance the bite cadence. Both are derived from a single
/// coherent read of the `hardcore`/`focused` flags inside [`IdleTimer::tick`],
/// so the pause decision and bite eligibility can never disagree within a tick.
pub struct TickOutcome {
    pub update: DecayUpdate,
    pub bite_eligible: bool,
}

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

    /// Advance the clock by one tick and report the snapshot plus bite
    /// eligibility, both derived from a single read of the hardcore/focused
    /// flags.
    ///
    /// Pauses when `hardcore && !focused` — the idle clock freezes on blur so
    /// decay does not progress while the user is away from the app's window.
    /// When hardcore is OFF, blur has no effect (v1/Arc-1 behaviour preserved).
    pub fn tick(&self, dt_ms: u64) -> TickOutcome {
        let hardcore = self.hardcore.load(Ordering::SeqCst);
        let focused = self.focused.load(Ordering::SeqCst);
        let ms_idle = if hardcore && !focused {
            self.ms_idle.load(Ordering::SeqCst) // paused: do not advance
        } else {
            self.ms_idle.fetch_add(dt_ms, Ordering::SeqCst) + dt_ms
        };
        let update = self.snapshot_at(ms_idle);
        // Bite-eligible only while held at full decay, focused, in hardcore —
        // computed from the SAME flag read as the pause decision above.
        let bite_eligible = hardcore && focused && update.level >= 1.0;
        TickOutcome {
            update,
            bite_eligible,
        }
    }

    /// Advance the counter by `dt_ms` and return just the snapshot. Thin wrapper
    /// over [`tick`](Self::tick) for callers (and tests) that don't need the
    /// bite-eligibility signal.
    pub fn advance(&self, dt_ms: u64) -> DecayUpdate {
        self.tick(dt_ms).update
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

/// Advance the bite-cadence accumulator by one tick.
///
/// Returns the new accumulator and whether a bite fires this tick. When
/// `eligible` is false the accumulator resets to zero — the cadence window only
/// runs while the timer is held at full decay, focused, in hardcore mode. On a
/// fire the remainder carries forward (`acc - cadence`) rather than zeroing, so
/// scheduler jitter never drops or double-counts a bite. `cadence` is always
/// positive (see [`Intensity::bite_cadence_ms`]); a single 100 ms tick can lift
/// `acc` at most one cadence-worth over the threshold, so one fire per tick.
fn advance_bite_accumulator(acc: u64, dt_ms: u64, eligible: bool, cadence: u64) -> (u64, bool) {
    if !eligible {
        return (0, false);
    }
    let acc = acc + dt_ms;
    if acc >= cadence {
        (acc - cadence, true)
    } else {
        (acc, false)
    }
}

/// Spawn the 100 ms tick thread that emits `decay-update` (and, in hardcore
/// mode at full decay, `decay-bite`) on `app`.
pub fn spawn(app: AppHandle, timer: Arc<IdleTimer>) {
    thread::spawn(move || {
        // Emit a crisp baseline immediately so the UI has state before tick 1.
        emit_update(&app, timer.snapshot());
        // Accumulated ms at full decay toward the next bite, and a
        // monotonically-increasing bite sequence number.
        let mut ms_since_bite: u64 = 0;
        let mut bite_seq: u64 = 0;
        loop {
            thread::sleep(Duration::from_millis(TICK_MS));
            let TickOutcome {
                update,
                bite_eligible,
            } = timer.tick(TICK_MS);
            emit_update(&app, update);

            let cadence = timer.intensity().bite_cadence_ms();
            let (acc, fired) =
                advance_bite_accumulator(ms_since_bite, TICK_MS, bite_eligible, cadence);
            ms_since_bite = acc;
            if fired {
                bite_seq += 1;
                emit_bite(&app, DecayBite { seq: bite_seq });
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

    // ── Hardcore: bite accumulator (pure, exercises the real cadence logic) ────

    #[test]
    fn bite_accumulator_resets_when_ineligible() {
        // A half-filled accumulator clears the instant we leave the bite-eligible
        // state (e.g. a keystroke drops level below full decay, or the window
        // blurs). This is the real reset path used by the tick loop.
        let (acc, fired) = advance_bite_accumulator(500, TICK_MS, false, 1_000);
        assert_eq!(acc, 0);
        assert!(!fired);
    }

    #[test]
    fn bite_accumulator_builds_without_firing_below_cadence() {
        let (acc, fired) = advance_bite_accumulator(800, TICK_MS, true, 1_000);
        assert_eq!(acc, 900);
        assert!(!fired);
    }

    #[test]
    fn bite_accumulator_fires_and_carries_remainder() {
        // 950 + 100 = 1050 ≥ 1000 → fire, remainder 50 carries into next window.
        let (acc, fired) = advance_bite_accumulator(950, TICK_MS, true, 1_000);
        assert_eq!(acc, 50);
        assert!(fired);
    }

    #[test]
    fn bite_accumulator_brutal_fires_every_ten_ticks() {
        // Drive the REAL accumulator across 30 ticks at brutal's 1000ms cadence.
        let cadence = Intensity::Brutal.bite_cadence_ms();
        let mut acc = 0u64;
        let mut fires = 0u64;
        for _ in 0..30 {
            let (next, fired) = advance_bite_accumulator(acc, TICK_MS, true, cadence);
            acc = next;
            if fired {
                fires += 1;
            }
        }
        assert_eq!(fires, 3); // 3000ms / 1000ms
        assert_eq!(acc, 0, "30 ticks land cleanly on a cadence boundary");
    }

    #[test]
    fn bite_accumulator_gentle_fires_every_thirty_ticks() {
        let cadence = Intensity::Gentle.bite_cadence_ms();
        let mut acc = 0u64;
        let mut fires = 0u64;
        for _ in 0..90 {
            let (next, fired) = advance_bite_accumulator(acc, TICK_MS, true, cadence);
            acc = next;
            if fired {
                fires += 1;
            }
        }
        assert_eq!(fires, 3); // 9000ms / 3000ms
    }

    // ── Hardcore: tick() bite-eligibility (single-read gating) ─────────────────

    #[test]
    fn tick_not_bite_eligible_below_full_decay() {
        let timer = IdleTimer::new(Intensity::Normal);
        timer.set_hardcore(true);
        let outcome = timer.tick(1_000); // 1000/5000 → t=0.2 → level 0.04
        assert!(!outcome.bite_eligible);
    }

    #[test]
    fn tick_bite_eligible_at_full_decay_in_hardcore() {
        let timer = IdleTimer::new(Intensity::Brutal);
        timer.set_hardcore(true);
        let outcome = timer.tick(2_000); // brutal full window → level 1.0
        assert!(outcome.bite_eligible);
    }

    #[test]
    fn tick_not_bite_eligible_when_hardcore_off() {
        let timer = IdleTimer::new(Intensity::Brutal);
        // hardcore off by default
        let outcome = timer.tick(2_000); // full decay, but not hardcore
        assert!(!outcome.bite_eligible);
    }

    #[test]
    fn tick_not_bite_eligible_when_blurred() {
        let timer = IdleTimer::new(Intensity::Brutal);
        timer.set_hardcore(true);
        timer.advance(2_000); // reach full decay while focused
        timer.set_focused(false); // blur
        let outcome = timer.tick(100); // paused + ineligible
        assert!(
            !outcome.bite_eligible,
            "blur makes the tick bite-ineligible"
        );
    }
}
