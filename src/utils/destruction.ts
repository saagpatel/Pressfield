// Pure text destruction for hardcore mode (v2 Arc 2). A "bite" permanently
// removes the trailing fraction of words from the document body — this is the
// math, isolated and tested; the DOM mutation, save flush, and undo defeat live
// in the decay-events hook (no decay logic in React components, per CLAUDE.md).

// Word = run of non-whitespace, matching wordBoxes.ts so the words that die are
// exactly the words the canvas was decaying.
const WORD = /\S+/g;

// Proportion of the document a single hardcore bite destroys (10% of current
// words, min 1). Constant across intensities — intensity scales the bite
// *cadence* (Rust `Intensity::bite_cadence_ms`), not the bite *size*.
export const BITE_FRACTION = 0.1;

/**
 * Return `text` with its trailing `fraction` of words permanently removed.
 *
 * - `fraction` is a proportion in (0, 1]; the count removed is `ceil(N·fraction)`
 *   with a floor of **1 word**, so every bite makes progress (even a tiny
 *   fraction on a long doc removes at least one word).
 * - Removing all remaining words erodes the body to `""`.
 * - Empty or whitespace-only input is returned unchanged (nothing to remove).
 * - Leading content of the surviving prefix is preserved byte-for-byte; only the
 *   tail (the removed words and the whitespace after the cut) is dropped.
 */
export function removeTrailingWords(text: string, fraction: number): string {
	const words = [...text.matchAll(WORD)];
	const count = words.length;
	if (count === 0) return text; // empty / whitespace-only: nothing to destroy

	const toRemove = Math.max(1, Math.ceil(count * fraction));
	const keep = count - toRemove;
	if (keep <= 0) return ""; // the tail ate the whole body

	// Slice to the end of the last surviving word, dropping it and everything
	// after — the removed words plus any whitespace between/after them.
	const lastKept = words[keep - 1];
	const cut = (lastKept.index ?? 0) + lastKept[0].length;
	return text.slice(0, cut);
}
