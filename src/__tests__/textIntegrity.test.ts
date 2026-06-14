// @vitest-environment happy-dom
//
// The text-integrity contract, split by mode (v2 Arc 2):
//   - Hardcore OFF (v1/Arc-1): decay is a recoverable VISUAL distortion only and
//     must NEVER mutate the underlying prose. Guarded by running the full decay
//     pass (word extraction + render) over a live contenteditable and asserting
//     the text is byte-identical afterward.
//   - Hardcore ON: past full decay, a bite permanently destroys the trailing
//     words and they do not come back. Guarded by applying the bite transform to
//     a live contenteditable and asserting the tail is gone, the head survives,
//     and sustained decay erodes the body to empty.
// Needs a DOM, so this one file opts into happy-dom; the rest of the suite stays
// in the node environment.
import { afterEach, describe, expect, it, vi } from "vitest";
import { type DecayContext, DecayRenderer, readTokens } from "../canvas/decay";
import { extractWordBoxes } from "../canvas/wordBoxes";
import { BITE_FRACTION, removeTrailingWords } from "../utils/destruction";

// A no-op canvas surface — the renderer only needs these members to run.
function stubCtx(): DecayContext {
	return {
		canvas: { width: 400, height: 200 },
		filter: "none",
		globalAlpha: 1,
		globalCompositeOperation: "source-over",
		fillStyle: "",
		font: "",
		textBaseline: "alphabetic",
		setTransform() {},
		clearRect() {},
		fillRect() {},
		fillText() {},
	};
}

const rect = (left: number, top: number, w: number, h: number): DOMRect =>
	({
		left,
		top,
		right: left + w,
		bottom: top + h,
		width: w,
		height: h,
		x: left,
		y: top,
		toJSON: () => ({}),
	}) as DOMRect;

describe("hardcore OFF: decay never mutates editor text (v1/Arc-1 contract)", () => {
	afterEach(() => vi.restoreAllMocks());

	it("leaves contenteditable text byte-identical after a full decay pass", () => {
		const editor = document.createElement("div");
		editor.setAttribute("contenteditable", "true");
		const prose = "The words must survive the decay.";
		editor.textContent = prose;
		document.body.appendChild(editor);

		// happy-dom has no layout, so Range.getBoundingClientRect returns zeros and
		// the extractor would filter every word. Stub it to a real box so the full
		// word-walk actually runs over the editor's text nodes (and would catch any
		// stray mutation in that read path).
		vi.spyOn(Range.prototype, "getBoundingClientRect").mockReturnValue(
			rect(10, 10, 60, 24),
		);

		const before = editor.innerText;

		const words = extractWordBoxes(editor, rect(0, 0, 400, 200));
		expect(words.length).toBeGreaterThan(0); // the read path really executed

		// A maxed-out decay event: full level, every distortion engaged.
		new DecayRenderer().render(stubCtx(), 1, words, readTokens(editor), 1);

		expect(editor.innerText).toBe(before);
		expect(editor.textContent).toBe(prose);
	});
});

describe("hardcore ON: decay destroys the tail past full decay (v2 Arc 2)", () => {
	it("permanently removes the trailing words, head survives", () => {
		const editor = document.createElement("div");
		editor.setAttribute("contenteditable", "true");
		editor.textContent = "alpha beta gamma delta epsilon"; // 5 words
		document.body.appendChild(editor);

		// One bite at the spec fraction: 10% of 5 → ceil(0.5) = 1 word off the tail.
		// This is exactly the in-place mutation the bite listener performs.
		editor.innerText = removeTrailingWords(editor.innerText, BITE_FRACTION);

		expect(editor.innerText).toBe("alpha beta gamma delta");
		expect(editor.innerText).not.toContain("epsilon"); // tail is gone
		expect(editor.innerText.startsWith("alpha beta gamma")).toBe(true); // head lives
	});

	it("erodes the document to empty under sustained decay", () => {
		const editor = document.createElement("div");
		editor.setAttribute("contenteditable", "true");
		editor.textContent = "one two three";
		document.body.appendChild(editor);

		// Sustained full decay = repeated bites. Each removes ≥1 word, so the body
		// monotonically erodes to nothing (the honest end state of hardcore).
		let guard = 0;
		while (editor.innerText.trim() !== "" && guard++ < 50) {
			editor.innerText = removeTrailingWords(editor.innerText, BITE_FRACTION);
		}
		expect(editor.innerText).toBe("");
	});
});
