//! The idle clock: a lock-free counter the decay state machine reads.
//!
//! A background thread ticks every 100 ms, advancing `ms_idle` and emitting a
//! [`DecayUpdate`] on the `decay-update` event. Any keystroke calls
//! [`IdleTimer::reset`], zeroing the counter so the next emit carries level 0.

use std::sync::atomic::{AtomicU64, AtomicU8, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Emitter};

use crate::decay::{decay_level, DecayUpdate, Intensity};

/// Emit cadence for the decay clock (10 Hz).
pub const TICK_MS: u64 = 100;

/// Event name carrying [`DecayUpdate`] payloads to the webview.
pub const DECAY_EVENT: &str = "decay-update";

/// Lock-free idle counter shared between the tick thread and command handlers.
///
/// `intensity` is an [`AtomicU8`] (encoded via [`Intensity::as_u8`]) so the
/// `set_intensity` command can retune the decay rate from the webview thread
/// without locking the tick thread.
pub struct IdleTimer {
    ms_idle: AtomicU64,
    intensity: AtomicU8,
}

impl IdleTimer {
    pub fn new(intensity: Intensity) -> Self {
        Self {
            ms_idle: AtomicU64::new(0),
            intensity: AtomicU8::new(intensity.as_u8()),
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
    /// falls back to `Normal` rather than panicking.
    fn intensity(&self) -> Intensity {
        Intensity::from_u8(self.intensity.load(Ordering::SeqCst)).unwrap_or(Intensity::Normal)
    }

    /// Advance the counter by `dt_ms` and return the resulting snapshot.
    pub fn advance(&self, dt_ms: u64) -> DecayUpdate {
        let ms_idle = self.ms_idle.fetch_add(dt_ms, Ordering::SeqCst) + dt_ms;
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

/// Spawn the 100 ms tick thread that emits `decay-update` on `app`.
pub fn spawn(app: AppHandle, timer: Arc<IdleTimer>) {
    thread::spawn(move || {
        // Emit a crisp baseline immediately so the UI has state before tick 1.
        emit(&app, timer.snapshot());
        loop {
            thread::sleep(Duration::from_millis(TICK_MS));
            emit(&app, timer.advance(TICK_MS));
        }
    });
}

fn emit(app: &AppHandle, update: DecayUpdate) {
    if let Err(err) = app.emit(DECAY_EVENT, update) {
        eprintln!("failed to emit {DECAY_EVENT}: {err}");
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
}
