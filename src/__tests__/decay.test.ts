import { describe, expect, it } from "vitest";
import {
	alphaForLevel,
	blurForLevel,
	type DecayContext,
	DecayRenderer,
	driftForLevel,
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

interface DrawCall {
	alpha: number;
	filter: string;
}

// Recording stub: jsdom has no 2D context, so we capture the alpha+filter state
// at each draw to assert the renderer's behavior at boundary levels.
function recordingCtx() {
	const fills: DrawCall[] = [];
	const texts: DrawCall[] = [];
	const ctx: DecayContext & { fills: DrawCall[]; texts: DrawCall[] } = {
		canvas: { width: 200, height: 100 },
		filter: "none",
		globalAlpha: 1,
		fillStyle: "",
		font: "",
		textBaseline: "alphabetic",
		setTransform() {},
		clearRect() {},
		fillRect() {
			fills.push({ alpha: ctx.globalAlpha, filter: ctx.filter });
		},
		fillText() {
			texts.push({ alpha: ctx.globalAlpha, filter: ctx.filter });
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

	it("paints faded, blurred ghosts at full decay (level 1)", () => {
		const ctx = recordingCtx();
		new DecayRenderer().render(ctx, 1, WORDS, TOKENS, 1);
		expect(ctx.texts).toHaveLength(1);
		expect(ctx.texts[0].alpha).toBeLessThanOrEqual(0.2);
		expect(ctx.texts[0].filter).toContain("blur");
	});

	it("occludes then paints one ghost per word", () => {
		const ctx = recordingCtx();
		new DecayRenderer().render(ctx, 0.7, WORDS, TOKENS, 1);
		expect(ctx.fills).toHaveLength(WORDS.length); // bg occlusion per word
		expect(ctx.texts).toHaveLength(WORDS.length); // ghost per word
	});
});
