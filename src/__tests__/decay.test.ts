import { describe, expect, it } from "vitest";
import {
	alphaForLevel,
	blurForLevel,
	type DecayContext,
	DecayRenderer,
	driftForLevel,
	driftVector,
	fringeForLevel,
	type RenderTokens,
} from "../canvas/decay";
import type { WordBox } from "../canvas/wordBoxes";

describe("level → visual mappings", () => {
	it("fades opacity from 1.0 to <= 0.2 across the range", () => {
		expect(alphaForLevel(0)).toBe(1);
		expect(alphaForLevel(1)).toBeLessThanOrEqual(0.2);
	});

	it("blurs from 0 to >= 4px", () => {
		expect(blurForLevel(0)).toBe(0);
		expect(blurForLevel(1)).toBeGreaterThanOrEqual(4);
	});

	it("drifts the baseline from 0 to >= 4px", () => {
		expect(driftForLevel(0)).toBe(0);
		expect(driftForLevel(1)).toBeGreaterThanOrEqual(4);
	});
});

describe("driftVector (per-word lateral scatter)", () => {
	it("is zero at rest for any word", () => {
		expect(driftVector(0, 0)).toEqual({ dx: 0, dy: 0 });
		expect(driftVector(7, 0)).toEqual({ dx: 0, dy: 0 });
	});

	it("is deterministic for a given index + level", () => {
		expect(driftVector(5, 0.8)).toEqual(driftVector(5, 0.8));
	});

	it("stays within ±12px lateral / ±4px vertical at full decay", () => {
		for (let i = 0; i < 50; i++) {
			const { dx, dy } = driftVector(i, 1);
			expect(Math.abs(dx)).toBeLessThanOrEqual(12);
			expect(Math.abs(dy)).toBeLessThanOrEqual(4);
		}
	});

	it("keeps a word's direction constant while magnitude grows with level", () => {
		const lo = driftVector(1, 0.4);
		const hi = driftVector(1, 0.8);
		expect(Math.sign(lo.dx)).toBe(Math.sign(hi.dx));
		expect(Math.sign(lo.dy)).toBe(Math.sign(hi.dy));
		expect(Math.abs(hi.dx)).toBeGreaterThan(Math.abs(lo.dx));
		expect(Math.abs(hi.dy)).toBeGreaterThan(Math.abs(lo.dy));
	});

	it("scatters words — including the first — in different directions", () => {
		// Decorrelated seeds → adjacent words don't drift in lockstep.
		expect(driftVector(0, 1)).not.toEqual(driftVector(1, 1));
		expect(driftVector(1, 1)).not.toEqual(driftVector(2, 1));
		// index 0 must not be pinned to the hard-left extreme ((index+1) seed).
		expect(Math.abs(driftVector(0, 1).dx)).toBeLessThan(12);
	});
});

interface DrawCall {
	alpha: number;
	filter: string;
	fillStyle: string;
	gco: GlobalCompositeOperation;
}

// Recording stub: jsdom has no 2D context, so we capture the full paint state
// (alpha, filter, fillStyle, composite op) at each draw to assert the
// renderer's behavior — including separating the primary ghost (source-over)
// from the screen-blended chromatic fringe passes.
function recordingCtx() {
	const fills: DrawCall[] = [];
	const texts: DrawCall[] = [];
	const snapshot = (): DrawCall => ({
		alpha: ctx.globalAlpha,
		filter: ctx.filter,
		fillStyle: String(ctx.fillStyle),
		gco: ctx.globalCompositeOperation,
	});
	const ctx: DecayContext & { fills: DrawCall[]; texts: DrawCall[] } = {
		canvas: { width: 200, height: 100 },
		filter: "none",
		globalAlpha: 1,
		globalCompositeOperation: "source-over",
		fillStyle: "",
		font: "",
		textBaseline: "alphabetic",
		setTransform() {},
		clearRect() {},
		fillRect() {
			fills.push(snapshot());
		},
		fillText() {
			texts.push(snapshot());
		},
		fills,
		texts,
	};
	return ctx;
}

const WORDS: WordBox[] = [{ text: "decay", x: 10, y: 10, w: 60, h: 24 }];
const TOKENS: RenderTokens = {
	bg: "#000",
	fg: "#fff",
	font: "300 22px serif",
	fontSizePx: 22,
};

describe("DecayRenderer.render", () => {
	it("draws nothing at rest (level 0)", () => {
		const ctx = recordingCtx();
		new DecayRenderer().render(ctx, 0, WORDS, TOKENS, 1);
		expect(ctx.texts).toHaveLength(0);
		expect(ctx.fills).toHaveLength(0);
	});

	it("paints a faded, blurred primary ghost at full decay (level 1)", () => {
		const ctx = recordingCtx();
		new DecayRenderer().render(ctx, 1, WORDS, TOKENS, 1);
		// First draw per word is the primary ghost (source-over fg); fringe
		// passes follow on top. Assert the primary stays faded + blurred.
		const primary = ctx.texts[0];
		expect(primary.gco).toBe("source-over");
		expect(primary.alpha).toBeLessThanOrEqual(0.2);
		expect(primary.filter).toContain("blur");
	});

	it("occludes and paints one primary ghost per word", () => {
		const ctx = recordingCtx();
		new DecayRenderer().render(ctx, 0.7, WORDS, TOKENS, 1);
		expect(ctx.fills).toHaveLength(WORDS.length); // bg occlusion per word
		const primaries = ctx.texts.filter((t) => t.gco === "source-over");
		expect(primaries).toHaveLength(WORDS.length); // one fg ghost per word
	});
});

describe("chromatic aberration", () => {
	it("adds no fringe at or below the 0.5 threshold", () => {
		expect(fringeForLevel(0.4)).toBe(0);
		expect(fringeForLevel(0.5)).toBe(0);
		const ctx = recordingCtx();
		new DecayRenderer().render(ctx, 0.4, WORDS, TOKENS, 1);
		expect(ctx.texts.every((t) => t.gco === "source-over")).toBe(true);
		// Cleanup leaves a clean composite mode even when no fringe ran.
		expect(ctx.globalCompositeOperation).toBe("source-over");
	});

	it("ramps the fringe from faint at 0.7 to prominent (≤2px) at 1.0", () => {
		expect(fringeForLevel(0.7)).toBeGreaterThan(0);
		expect(fringeForLevel(1)).toBeGreaterThan(fringeForLevel(0.7));
		expect(fringeForLevel(1)).toBeLessThanOrEqual(2);
	});

	it("draws screen-blended red + cyan offset passes above 0.5", () => {
		const ctx = recordingCtx();
		new DecayRenderer().render(ctx, 0.8, WORDS, TOKENS, 1);
		const fringe = ctx.texts.filter((t) => t.gco === "screen");
		expect(fringe).toHaveLength(WORDS.length * 2); // red + cyan per word
		const colours = fringe.map((t) => t.fillStyle);
		expect(colours).toContain("rgb(255,0,0)");
		expect(colours).toContain("rgb(0,255,255)");
	});

	it("restores source-over compositing after the fringe", () => {
		const ctx = recordingCtx();
		new DecayRenderer().render(ctx, 0.9, WORDS, TOKENS, 1);
		expect(ctx.globalCompositeOperation).toBe("source-over");
	});
});
