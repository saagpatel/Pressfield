// IPC payload types and runtime guards shared across the frontend.
// Mirrors the Rust types in src-tauri/src/decay.rs and session_store.rs.

export type Intensity = "gentle" | "normal" | "brutal";

// Visual decay phase, derived on the frontend from DecayUpdate.level (Phase 1+).
export type DecayState = "idle" | "decaying" | "critical" | "reset";

export interface DecayUpdate {
	level: number; // 0.0 (crisp) -> 1.0 (fully decayed)
	ms_idle: number; // raw ms since last keystroke
	intensity: Intensity;
}

export interface SessionStats {
	session_id: number;
	started_at: number; // unix ms
	word_count: number;
	decay_events: number;
	intensity: Intensity;
	document_id: number | null; // mirrors Rust Option<i64>; null pre-migration
}

// A named document with its prose body (mirrors Rust `Document`). Named
// `DocumentRecord` so it doesn't shadow the DOM `Document` global.
export interface DocumentRecord {
	id: number;
	name: string;
	body: string;
	created_at: number; // unix ms
	updated_at: number; // unix ms
}

const INTENSITIES: readonly Intensity[] = ["gentle", "normal", "brutal"];

function isIntensity(value: unknown): value is Intensity {
	return (
		typeof value === "string" &&
		(INTENSITIES as readonly string[]).includes(value)
	);
}

// Narrow an untrusted IPC event payload to a DecayUpdate before use.
// `level` is range-checked to [0, 1] so downstream Canvas math can trust it.
export function isDecayUpdate(value: unknown): value is DecayUpdate {
	if (typeof value !== "object" || value === null) return false;
	const v = value as Record<string, unknown>;
	return (
		typeof v.level === "number" &&
		Number.isFinite(v.level) &&
		v.level >= 0 &&
		v.level <= 1 &&
		typeof v.ms_idle === "number" &&
		Number.isFinite(v.ms_idle) &&
		isIntensity(v.intensity)
	);
}
