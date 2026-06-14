// Intl.Segmenter word counter — handles emoji, multibyte scripts, and trailing
// whitespace where `innerText.split(/\s+/)` miscounts. Consumed by the session
// stats panel in Phase 3; unit-tested here per the Phase 1 test plan.
//
// Minimal local types: the project's ES2020 lib doesn't declare Intl.Segmenter,
// so we describe only the surface we use rather than widening the global lib.
interface WordSegment {
	isWordLike?: boolean;
}
interface WordSegmenter {
	segment(input: string): Iterable<WordSegment>;
}
interface SegmenterCtor {
	new (
		locales?: string | string[],
		options?: { granularity?: "word" },
	): WordSegmenter;
}

export function wordCount(text: string): number {
	const trimmed = text.trim();
	if (trimmed === "") return 0;

	const Segmenter = (Intl as unknown as { Segmenter?: SegmenterCtor })
		.Segmenter;
	if (Segmenter) {
		const segmenter = new Segmenter(undefined, { granularity: "word" });
		let count = 0;
		for (const segment of segmenter.segment(trimmed)) {
			if (segment.isWordLike) count++;
		}
		return count;
	}

	// Fallback for runtimes without Intl.Segmenter: Unicode letter/number runs.
	return (trimmed.match(/[\p{L}\p{N}]+/gu) ?? []).length;
}
