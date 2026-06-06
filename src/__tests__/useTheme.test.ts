import { describe, expect, it } from "vitest";
import { nextTheme, parseTheme } from "../hooks/useTheme";

describe("nextTheme", () => {
	it("toggles between dark and light", () => {
		expect(nextTheme("dark")).toBe("light");
		expect(nextTheme("light")).toBe("dark");
	});
});

describe("parseTheme", () => {
	it("passes through valid stored themes", () => {
		expect(parseTheme("light")).toBe("light");
		expect(parseTheme("dark")).toBe("dark");
	});

	it("defaults to dark for missing or invalid values", () => {
		expect(parseTheme(null)).toBe("dark");
		expect(parseTheme("")).toBe("dark");
		expect(parseTheme("blurple")).toBe("dark");
	});
});
