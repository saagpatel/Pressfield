// @vitest-environment happy-dom
//
// The v1 hardcore contract: decay is a recoverable VISUAL distortion only — it
// must never mutate the underlying prose. This guards it by running the full
// decay pass (word extraction + render) over a live contenteditable and
// asserting its text is byte-identical afterward. Needs a DOM, so this one file
// opts into happy-dom; the rest of the suite stays in the node environment.
import { afterEach, describe, expect, it, vi } from "vitest";
import { type DecayContext, DecayRenderer, readTokens } from "../canvas/decay";
import { extractWordBoxes } from "../canvas/wordBoxes";

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

describe("decay never mutates editor text (v1 hardcore contract)", () => {
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
