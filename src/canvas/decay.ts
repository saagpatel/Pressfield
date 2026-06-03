// All Canvas 2D decay rendering lives here — never in React components.
//
// Phase 1 distortion: opacity fade + Gaussian blur + baseline drift, painted
// over per-word DOM geometry. At rest (level≈0) the canvas stays transparent so
// the crisp contenteditable shows through; as decay rises, each word is occluded
// and replaced by a faded, blurred, drifting ghost. Word lateral drift and
// chromatic aberration arrive in Phase 2.

import type { WordBox } from "./wordBoxes";

// Below this level the overlay renders nothing (crisp text shows through).
const REST_EPSILON = 0.01;

// Opacity of the distorted glyphs: 1.0 crisp → 0.2 at full decay.
export function alphaForLevel(level: number): number {
	return 1 - level * 0.8;
}

// Gaussian blur radius in CSS px: 0 → 4px at full decay.
export function blurForLevel(level: number): number {
	return level * 4;
}

// Baseline drift in CSS px: 0 → 6px at full decay (glyphs slide off the line).
export function driftForLevel(level: number): number {
	return level * 6;
}

export interface RenderTokens {
	bg: string;
	fg: string;
	font: string; // canvas font shorthand, e.g. "300 22px Georgia, serif"
	fontSizePx: number; // parsed font size, for line-box → glyph-top alignment
}

// Minimal slice of CanvasRenderingContext2D the renderer touches. Declaring it
// lets tests drive render() with a recording stub instead of a real canvas
// (jsdom has no 2D context), while a live context satisfies it structurally.
export interface DecayContext {
	canvas: { width: number; height: number };
	filter: string;
	globalAlpha: number;
	fillStyle: string | CanvasGradient | CanvasPattern;
	font: string;
	textBaseline: CanvasTextBaseline;
	setTransform(
		a: number,
		b: number,
		c: number,
		d: number,
		e: number,
		f: number,
	): void;
	clearRect(x: number, y: number, w: number, h: number): void;
	fillRect(x: number, y: number, w: number, h: number): void;
	fillText(text: string, x: number, y: number): void;
}

export class DecayRenderer {
	// `dpr` keeps the backing store high-DPI while we draw in CSS px.
	render(
		ctx: DecayContext,
		level: number,
		words: readonly WordBox[],
		tokens: RenderTokens,
		dpr: number,
	): void {
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
		if (level <= REST_EPSILON) {
			return; // at rest the overlay is fully transparent
		}

		ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS px on a HiDPI store
		const blur = blurForLevel(level);
		const alpha = alphaForLevel(level);
		const drift = driftForLevel(level);
		ctx.font = tokens.font;
		ctx.textBaseline = "top";

		for (const word of words) {
			// Occlude the crisp word underneath; occlusion strengthens with decay.
			ctx.filter = "none";
			ctx.globalAlpha = level;
			ctx.fillStyle = tokens.bg;
			ctx.fillRect(word.x - 1, word.y - 1, word.w + 2, word.h + 2);

			// The word's Range rect spans the line box (line-height leading); offset
			// down to the glyph top so the ghost sits on its word, then drift below.
			const glyphTop = word.y + Math.max(0, (word.h - tokens.fontSizePx) / 2);

			// Paint the decaying ghost: faded, blurred, drifted off its baseline.
			ctx.filter = blur > 0 ? `blur(${blur}px)` : "none";
			ctx.globalAlpha = alpha;
			ctx.fillStyle = tokens.fg;
			ctx.fillText(word.text, word.x, glyphTop + drift);
		}

		// Restore defaults so the next frame's clear isn't filtered or alpha'd.
		ctx.filter = "none";
		ctx.globalAlpha = 1;
	}
}

// Read the editor's computed colours + font into a canvas-ready token set.
export function readTokens(editor: HTMLElement): RenderTokens {
	const cs = getComputedStyle(editor);
	const bg =
		getComputedStyle(document.documentElement)
			.getPropertyValue("--bg")
			.trim() || "#0e0e10";
	return {
		bg,
		fg: cs.color,
		font: `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`,
		fontSizePx: parseFloat(cs.fontSize) || 16,
	};
}
