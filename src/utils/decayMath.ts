// Pure decay math shared by the Canvas pipeline. Phase 2 adds levelFromMs
// (cubic ease-in) here; Phase 1 only needs clamping + tick interpolation.

export function clamp01(x: number): number {
	if (x < 0) return 0;
	if (x > 1) return 1;
	return x;
}

export interface LevelSample {
	level: number;
	t: number; // performance.now() ms when the sample arrived
}

// How far past the latest sample we still extrapolate. Beyond this the Rust
// tick is overdue (sleep / suspend / IPC backpressure), so we hold the last
// level rather than letting the projection surge toward full decay.
const MAX_PROJECT_MS = 150;

// Project the decay level at time `now` from the last two samples.
//
// The Rust clock emits ~10 Hz; this linearly extrapolates the most recent
// segment so the Canvas animates at 60 fps without visible 100 ms steps.
// Result is clamped to [0, 1].
export function projectLevel(
	prev: LevelSample | undefined,
	next: LevelSample | undefined,
	now: number,
): number {
	if (!next) return 0;
	if (!prev || next.t <= prev.t) return clamp01(next.level);
	const dt = Math.min(Math.max(now - next.t, 0), MAX_PROJECT_MS);
	const slope = (next.level - prev.level) / (next.t - prev.t);
	return clamp01(next.level + slope * dt);
}
