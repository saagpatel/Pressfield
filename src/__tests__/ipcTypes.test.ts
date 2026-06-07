import { describe, expect, it } from "vitest";
import { isDecayBite, isDecayUpdate } from "../types/ipc";

describe("isDecayUpdate", () => {
	it("accepts a well-formed DecayUpdate payload", () => {
		expect(
			isDecayUpdate({ level: 0.5, ms_idle: 2500, intensity: "normal" }),
		).toBe(true);
	});

	it("accepts boundary levels 0 and 1 across intensities", () => {
		expect(isDecayUpdate({ level: 0, ms_idle: 0, intensity: "gentle" })).toBe(
			true,
		);
		expect(
			isDecayUpdate({ level: 1, ms_idle: 8000, intensity: "brutal" }),
		).toBe(true);
	});

	it("rejects an out-of-range level", () => {
		expect(isDecayUpdate({ level: 1.5, ms_idle: 0, intensity: "normal" })).toBe(
			false,
		);
		expect(
			isDecayUpdate({ level: -0.1, ms_idle: 0, intensity: "normal" }),
		).toBe(false);
	});

	it("rejects an unknown intensity", () => {
		expect(
			isDecayUpdate({ level: 0.5, ms_idle: 2500, intensity: "savage" }),
		).toBe(false);
	});

	it("rejects a payload missing fields", () => {
		expect(isDecayUpdate({ level: 0.5, ms_idle: 2500 })).toBe(false);
	});

	it("rejects a non-finite level", () => {
		expect(isDecayUpdate({ level: NaN, ms_idle: 0, intensity: "normal" })).toBe(
			false,
		);
	});

	it("rejects null and primitive payloads", () => {
		expect(isDecayUpdate(null)).toBe(false);
		expect(isDecayUpdate(42)).toBe(false);
		expect(isDecayUpdate("decay")).toBe(false);
	});
});

// isDecayBite gates an irreversible action (text destruction), so it must reject
// anything that isn't a well-formed DecayBite payload.
describe("isDecayBite", () => {
	it("accepts a valid DecayBite payload", () => {
		expect(isDecayBite({ seq: 0 })).toBe(true);
		expect(isDecayBite({ seq: 42 })).toBe(true);
	});

	it("ignores extra properties as long as seq is a finite number", () => {
		expect(isDecayBite({ seq: 3, extra: "ignored" })).toBe(true);
	});

	it("rejects a missing or non-numeric seq", () => {
		expect(isDecayBite({})).toBe(false);
		expect(isDecayBite({ seq: "1" })).toBe(false);
		expect(isDecayBite({ seq: NaN })).toBe(false);
		expect(isDecayBite({ seq: Number.POSITIVE_INFINITY })).toBe(false);
	});

	it("rejects null and primitive payloads", () => {
		expect(isDecayBite(null)).toBe(false);
		expect(isDecayBite(undefined)).toBe(false);
		expect(isDecayBite(7)).toBe(false);
		expect(isDecayBite("seq")).toBe(false);
	});
});
