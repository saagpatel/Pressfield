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

    /// Compact tag for the lock-free `AtomicU8` in [`crate::idle_timer`].
    pub fn as_u8(self) -> u8 {
        match self {
            Intensity::Gentle => 0,
            Intensity::Normal => 1,
            Intensity::Brutal => 2,
        }
    }

    /// Inverse of [`Intensity::as_u8`]; `None` for an unknown tag.
    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            0 => Some(Intensity::Gentle),
            1 => Some(Intensity::Normal),
            2 => Some(Intensity::Brutal),
            _ => None,
        }
    }

    /// Milliseconds between successive destruction bites when held at full decay
    /// in hardcore mode. Brutal eats fastest; Gentle is the most forgiving.
    pub fn bite_cadence_ms(self) -> u64 {
        match self {
            Intensity::Brutal => 1_000,
            Intensity::Normal => 2_000,
            Intensity::Gentle => 3_000,
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

/// Payload for the `decay-bite` event (hardcore mode: text was destroyed).
///
/// `seq` is a monotonically-increasing counter so the frontend can detect
/// dropped events (e.g. under IPC backpressure); starts at 1 on first bite.
#[derive(Debug, Clone, Serialize)]
pub struct DecayBite {
    pub seq: u64,
}

/// Event name for hardcore-mode destruction bites.
pub const DECAY_BITE_EVENT: &str = "decay-bite";

/// Map idle milliseconds to a decay level in `[0.0, 1.0]`.
///
/// Quadratic ease-in: `t = ms_idle / full_decay_ms` clamped to `[0, 1]`, then
/// `t²`. A slow start that accelerates, so a longer pause bites
/// disproportionately harder than a linear ramp. This is the authoritative
/// curve — `src/utils/decayMath.ts::levelFromMs` mirrors it for the vitest box.
/// [`Intensity::full_decay_ms`] sets how much idle time reaches `1.0`.
pub fn decay_level(ms_idle: u64, intensity: Intensity) -> f32 {
    let full = intensity.full_decay_ms() as f32;
    let t = (ms_idle as f32 / full).min(1.0);
    t * t
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
    fn quadratic_ramp_hits_quarter_at_midpoint() {
        // Halfway through full_decay_ms → t=0.5 → t²=0.25 under the Phase 2
        // quadratic ease-in. This is the Rust side of the Phase 2 curve gate.
        assert_eq!(decay_level(2_500, Intensity::Normal), 0.25);
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

    #[test]
    fn bite_cadence_brutal_fastest() {
        assert_eq!(Intensity::Brutal.bite_cadence_ms(), 1_000);
        assert_eq!(Intensity::Normal.bite_cadence_ms(), 2_000);
        assert_eq!(Intensity::Gentle.bite_cadence_ms(), 3_000);
        // Brutal < Normal < Gentle (faster bites = shorter cadence).
        assert!(Intensity::Brutal.bite_cadence_ms() < Intensity::Normal.bite_cadence_ms());
        assert!(Intensity::Normal.bite_cadence_ms() < Intensity::Gentle.bite_cadence_ms());
    }

    #[test]
    fn decay_bite_serializes_seq() {
        let bite = super::DecayBite { seq: 42 };
        let json = serde_json::to_string(&bite).unwrap();
        assert!(json.contains("42"), "seq must appear in payload");
    }
}
