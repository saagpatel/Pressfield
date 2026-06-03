//! Decay types and the pure idle→level mapping.
//!
//! This module is the math + wire types; the live counter lives in
//! [`crate::idle_timer`]. Phase 0 uses a linear ramp — the cubic ease-in is a
//! Phase 2 deliverable (`src/utils/decayMath.ts`, IMPLEMENTATION-PLAN §4).

use serde::{Deserialize, Serialize};

/// How aggressively prose decays during idle time.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Intensity {
    Gentle,
    Normal,
    Brutal,
}

impl Intensity {
    /// Milliseconds of idle time that map to `decay_level = 1.0`.
    pub fn full_decay_ms(self) -> u64 {
        match self {
            Intensity::Gentle => 8_000,
            Intensity::Normal => 5_000,
            Intensity::Brutal => 2_000,
        }
    }

    /// Stable lowercase tag stored in the `intensity` SQLite column.
    pub fn as_str(self) -> &'static str {
        match self {
            Intensity::Gentle => "gentle",
            Intensity::Normal => "normal",
            Intensity::Brutal => "brutal",
        }
    }
}

/// Live decay snapshot carried by the `decay-update` event.
#[derive(Debug, Clone, Serialize)]
pub struct DecayUpdate {
    /// 0.0 (crisp) → 1.0 (fully decayed).
    pub level: f32,
    /// Raw milliseconds since the last keystroke.
    pub ms_idle: u64,
    pub intensity: Intensity,
}

/// Map idle milliseconds to a decay level in `[0.0, 1.0]`.
///
/// Linear ramp clamped at full decay; [`Intensity::full_decay_ms`] sets how
/// much idle time reaches `1.0`.
pub fn decay_level(ms_idle: u64, intensity: Intensity) -> f32 {
    let full = intensity.full_decay_ms() as f32;
    (ms_idle as f32 / full).min(1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn level_is_zero_at_start() {
        assert_eq!(decay_level(0, Intensity::Normal), 0.0);
    }

    #[test]
    fn level_reaches_one_at_full_decay() {
        assert_eq!(decay_level(5_000, Intensity::Normal), 1.0);
        assert_eq!(decay_level(8_000, Intensity::Gentle), 1.0);
        assert_eq!(decay_level(2_000, Intensity::Brutal), 1.0);
    }

    #[test]
    fn level_clamps_past_full_decay() {
        assert_eq!(decay_level(10_000, Intensity::Normal), 1.0);
        assert!(decay_level(1_000_000, Intensity::Brutal) <= 1.0);
    }

    #[test]
    fn linear_ramp_hits_midpoint() {
        // Halfway through full_decay_ms → 0.5 under the Phase 0 linear ramp.
        assert_eq!(decay_level(2_500, Intensity::Normal), 0.5);
    }

    #[test]
    fn level_is_monotonic_increasing() {
        let mut prev = decay_level(0, Intensity::Normal);
        for ms in (0..=6_000).step_by(250) {
            let cur = decay_level(ms, Intensity::Normal);
            assert!(
                cur >= prev,
                "decay must not decrease: {cur} < {prev} at {ms}ms"
            );
            prev = cur;
        }
    }

    #[test]
    fn intensity_serializes_lowercase() {
        assert_eq!(
            serde_json::to_string(&Intensity::Brutal).unwrap(),
            "\"brutal\""
        );
        assert_eq!(Intensity::Gentle.as_str(), "gentle");
    }
}
