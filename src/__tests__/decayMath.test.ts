import { describe, expect, it } from "vitest";
import { clamp01, levelFromMs, projectLevel } from "../utils/decayMath";

describe("clamp01", () => {
	it("clamps below 0 and above 1, passes through in-range", () => {
		expect(clamp01(-0.5)).toBe(0);
		expect(clamp01(1.5)).toBe(1);
		expect(clamp01(0.3)).toBe(0.3);
	});
});

describe("projectLevel", () => {
	it("returns 0 with no samples", () => {
		expect(projectLevel(undefined, undefined, 100)).toBe(0);
	});

	it("returns the single sample's level when only one exists", () => {
		expect(projectLevel(undefined, { level: 0.4, t: 100 }, 250)).toBe(0.4);
	});

	it("extrapolates the rising segment between ticks", () => {
		// slope 0.1 per 100ms → +50ms past the last sample → +0.05.
		const v = projectLevel({ level: 0.4, t: 100 }, { level: 0.5, t: 200 }, 250);
		expect(v).toBeCloseTo(0.55, 5);
	});

	it("clamps extrapolation to 1.0", () => {
		const v = projectLevel(
			{ level: 0.8, t: 100 },
			{ level: 0.95, t: 200 },
			1000,
		);
		expect(v).toBe(1);
	});

	it("holds the level once extrapolation exceeds the ~150ms horizon", () => {
		// Gentle slope, far-future now → dt is capped so it never surges to 1.0.
		const v = projectLevel(
			{ level: 0.4, t: 100 },
			{ level: 0.5, t: 200 },
			5000,
		);
		expect(v).toBeCloseTo(0.65, 5); // 0.5 + slope(0.001) * 150
	});

	it("returns the latest level exactly at its timestamp", () => {
		expect(
			projectLevel({ level: 0.2, t: 100 }, { level: 0.3, t: 200 }, 200),
		).toBeCloseTo(0.3, 5);
	});
});

describe("levelFromMs (quadratic ease-in — mirrors Rust decay_level)", () => {
	it("is exactly 0 at the start and 1 at full decay", () => {
		expect(levelFromMs(0, "normal")).toBe(0);
		expect(levelFromMs(5000, "normal")).toBe(1);
	});

	it("eases in — quarter decay at the midpoint (the Phase 2 gate)", () => {
		// 2500ms is half of normal's 5000ms window → t=0.5 → t²=0.25.
		expect(levelFromMs(2500, "normal")).toBeCloseTo(0.25, 5);
	});

	it("clamps below 0 and past full decay", () => {
		expect(levelFromMs(-100, "normal")).toBe(0);
		expect(levelFromMs(10_000, "normal")).toBe(1);
	});

	it("scales the full-decay window by intensity", () => {
		expect(levelFromMs(2000, "brutal")).toBe(1);
		expect(levelFromMs(8000, "gentle")).toBe(1);
		// At a fixed idle time, the faster intensity has decayed further.
		expect(levelFromMs(1000, "normal")).toBeLessThan(
			levelFromMs(1000, "brutal"),
		);
	});

	it("is strictly increasing across the ramp", () => {
		let prev = -1;
		for (let ms = 0; ms <= 5000; ms += 250) {
			const cur = levelFromMs(ms, "normal");
			expect(cur).toBeGreaterThan(prev);
			prev = cur;
		}
	});
});
