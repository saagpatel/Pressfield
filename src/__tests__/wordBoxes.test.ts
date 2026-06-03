import { describe, expect, it, vi } from "vitest";
import { type WordBox, WordBoxCache } from "../canvas/wordBoxes";

// The cache's contract is the dirty-flag logic; the extractor is injected so we
// exercise it without a live DOM (jsdom has no layout for getBoundingClientRect).
const editor = {} as HTMLElement;
const rect = {} as DOMRect;
const SAMPLE: WordBox[] = [{ text: "decay", x: 0, y: 0, w: 10, h: 4 }];

describe("WordBoxCache", () => {
	it("measures eagerly on first use", () => {
		const extract = vi.fn(() => SAMPLE);
		const cache = new WordBoxCache(extract);
		expect(cache.boxes(editor, rect)).toBe(SAMPLE);
		expect(extract).toHaveBeenCalledTimes(1);
	});

	it("serves the cache without re-measuring until invalidated", () => {
		const extract = vi.fn(() => SAMPLE);
		const cache = new WordBoxCache(extract);
		cache.boxes(editor, rect);
		cache.boxes(editor, rect);
		cache.boxes(editor, rect);
		expect(extract).toHaveBeenCalledTimes(1); // one measure, three reads
	});

	it("re-measures once after invalidate()", () => {
		const extract = vi.fn(() => SAMPLE);
		const cache = new WordBoxCache(extract);
		cache.boxes(editor, rect);
		cache.invalidate();
		cache.boxes(editor, rect);
		cache.boxes(editor, rect);
		expect(extract).toHaveBeenCalledTimes(2); // re-measure once, then cached
	});
});
