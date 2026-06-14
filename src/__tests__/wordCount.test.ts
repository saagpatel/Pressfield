import { describe, expect, it } from "vitest";
import { wordCount } from "../utils/wordCount";

describe("wordCount", () => {
	it("counts plain words", () => {
		expect(wordCount("hello world")).toBe(2);
		expect(wordCount("the quick brown fox")).toBe(4);
	});

	it("returns 0 for empty or whitespace-only text", () => {
		expect(wordCount("")).toBe(0);
		expect(wordCount("   \n\t  ")).toBe(0);
	});

	it("ignores leading, trailing, and duplicate whitespace", () => {
		expect(wordCount("  spaced   out  ")).toBe(2);
	});

	it("does not count emoji as words", () => {
		expect(wordCount("hi 👋 there")).toBe(2);
	});

	it("counts multibyte (CJK) word runs", () => {
		expect(wordCount("日本語 です")).toBeGreaterThanOrEqual(2);
	});
});
