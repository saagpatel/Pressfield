import { describe, expect, it } from "vitest";
import { formatElapsed } from "../components/StatsPanel";

describe("formatElapsed", () => {
	it("formats sub-minute spans with zero-padded seconds", () => {
		expect(formatElapsed(0)).toBe("0:00");
		expect(formatElapsed(5_000)).toBe("0:05");
		expect(formatElapsed(59_000)).toBe("0:59");
	});

	it("rolls over into minutes", () => {
		expect(formatElapsed(60_000)).toBe("1:00");
		expect(formatElapsed(125_000)).toBe("2:05");
	});

	it("floors partial seconds", () => {
		expect(formatElapsed(1_999)).toBe("0:01");
	});

	it("clamps negative spans to zero", () => {
		expect(formatElapsed(-1_000)).toBe("0:00");
	});
});
