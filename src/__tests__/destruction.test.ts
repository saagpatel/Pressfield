import { describe, expect, it } from "vitest";

import { removeTrailingWords } from "../utils/destruction";

// removeTrailingWords is the pure heart of a hardcore "bite": given the editor's
// text and a fraction, it returns the body with the trailing fraction of words
// permanently gone (min 1 word). Tokenization mirrors wordBoxes.ts (/\S+/g) so
// what dies matches what the canvas was decaying.
describe("removeTrailingWords", () => {
	it("removes the trailing fraction of words", () => {
		const text = "a b c d e f g h i j"; // 10 words
		// 10% of 10 = 1 word off the tail.
		expect(removeTrailingWords(text, 0.1)).toBe("a b c d e f g h i");
	});

	it("removes at least one word even when the fraction rounds to zero", () => {
		const text = "one two three"; // 3 words; 10% → ceil(0.3) = 1
		expect(removeTrailingWords(text, 0.1)).toBe("one two");
	});

	it("rounds the count up (ceil), not down", () => {
		const text = "a b c d e"; // 5 words; 30% → ceil(1.5) = 2
		expect(removeTrailingWords(text, 0.3)).toBe("a b c");
	});

	it("erodes the last word to empty", () => {
		expect(removeTrailingWords("solitude", 0.1)).toBe("");
	});

	it("erodes the whole doc to empty when the fraction is 1.0", () => {
		expect(removeTrailingWords("two words", 1.0)).toBe("");
	});

	it("is a no-op on an empty string", () => {
		expect(removeTrailingWords("", 0.1)).toBe("");
	});

	it("is a no-op on whitespace-only input", () => {
		expect(removeTrailingWords("   \n\t ", 0.1)).toBe("   \n\t ");
	});

	it("preserves leading whitespace of the kept prefix", () => {
		// Leading indentation/newlines before the surviving text are untouched;
		// only the tail (removed word + the whitespace after it) is dropped.
		expect(removeTrailingWords("  hello world", 0.1)).toBe("  hello");
	});

	it("drops interior whitespace that follows the cut point", () => {
		// Multiline: 4 words; 50% → 2 removed → keep through the 2nd word, the
		// newline and everything after it go.
		expect(removeTrailingWords("line one\nline two", 0.5)).toBe("line one");
	});
});
