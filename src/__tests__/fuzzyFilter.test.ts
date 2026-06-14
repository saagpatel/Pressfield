import { describe, expect, it } from "vitest";
import { fuzzyFilter } from "../utils/fuzzyFilter";

const docs = [
	{ name: "My Essay" },
	{ name: "Grocery List" },
	{ name: "Untitled" },
	{ name: "Project Notes" },
];

describe("fuzzyFilter", () => {
	it("returns all items in original order for an empty query", () => {
		expect(fuzzyFilter(docs, "")).toEqual(docs);
	});

	it("treats a whitespace-only query as empty", () => {
		expect(fuzzyFilter(docs, "   ")).toEqual(docs);
	});

	it("matches a case-insensitive subsequence of the name", () => {
		// "esy" is a subsequence of "Essay" (E-s-s-a-y).
		const result = fuzzyFilter(docs, "esy");
		expect(result).toEqual([{ name: "My Essay" }]);
	});

	it("matches across word boundaries as a subsequence", () => {
		// "pno" → Project Notes (P...N...o).
		expect(fuzzyFilter(docs, "pno")).toEqual([{ name: "Project Notes" }]);
	});

	it("excludes items whose name is not a supersequence of the query", () => {
		expect(fuzzyFilter(docs, "zzz")).toEqual([]);
	});

	it("preserves input order among multiple matches", () => {
		// "t" appears in Essay? no. Grocery List (t), Untitled (t), Project Notes (t).
		const result = fuzzyFilter(docs, "t").map((d) => d.name);
		expect(result).toEqual(["Grocery List", "Untitled", "Project Notes"]);
	});

	it("requires query characters in order, not just presence", () => {
		// "yasse" — chars present in "My Essay" but NOT in subsequence order.
		expect(fuzzyFilter(docs, "yasse")).toEqual([]);
	});
});
