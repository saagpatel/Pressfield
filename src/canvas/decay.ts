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

// Knuth multiplicative constant (⌊2³²·φ⁻¹⌋) and a decorrelating salt for the
// second axis, so dx and dy hash independently from the same word index.
const KNUTH = 2_654_435_761;
const DRIFT_SALT = 0x9e3779b9;
const MAX_DRIFT_X = 12; // px lateral at level 1
const MAX_DRIFT_Y = 4; // px vertical at level 1

// Map a 32-bit hash to a signed unit offset in [-1, 1].
function signedUnit(hash: number): number {
	return ((hash >>> 0) / 0xffffffff) * 2 - 1;
}

// Chromatic aberration only appears in the back half of the decay, growing the
// RGB channel split from 0 at level 0.5 to MAX_FRINGE px at full decay.
const FRINGE_THRESHOLD = 0.5;
const MAX_FRINGE = 2; // px of red/cyan separation at level 1

// Half-width of the chromatic RGB split in CSS px: 0 below the threshold, then
// a linear ramp to MAX_FRINGE at full decay. Faint near 0.7, prominent at 1.0.
export function fringeForLevel(level: number): number {
	if (level <= FRINGE_THRESHOLD) return 0;
	return ((level - FRINGE_THRESHOLD) / (1 - FRINGE_THRESHOLD)) * MAX_FRINGE;
}

// Deterministic per-word scatter vector. Seeded on the word's index, so a word
// always drifts the same direction across animation frames (the word list is
// stable during an idle decay episode); magnitude scales linearly with `level`,
// so the word slides further as decay deepens but never changes heading.
export function driftVector(
	index: number,
	level: number,
): { dx: number; dy: number } {
	if (level <= 0) return { dx: 0, dy: 0 }; // at rest: no scatter, clean zeros
	// Seed on (index + 1): index 0 would hash to 0 → signedUnit(0) = -1, pinning
	// the document's first word to the hard-left extreme instead of scattering.
	const h = (index + 1) * KNUTH;
	return {
		dx: signedUnit(h) * MAX_DRIFT_X * level,
		dy: signedUnit(h ^ DRIFT_SALT) * MAX_DRIFT_Y * level,
	};
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
	globalCompositeOperation: GlobalCompositeOperation;
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
		const fringe = fringeForLevel(level);
		ctx.font = tokens.font;
		ctx.textBaseline = "top";

		for (let i = 0; i < words.length; i++) {
			const word = words[i];
			// Occlude the crisp word underneath, in place; occlusion strengthens
			// with decay while the ghost drifts away from this anchor box.
			ctx.filter = "none";
			ctx.globalAlpha = level;
			ctx.fillStyle = tokens.bg;
			ctx.fillRect(word.x - 1, word.y - 1, word.w + 2, word.h + 2);

			// The word's Range rect spans the line box (line-height leading); offset
			// down to the glyph top so the ghost sits on its word, then drift below.
			const glyphTop = word.y + Math.max(0, (word.h - tokens.fontSizePx) / 2);
			// Per-word lateral scatter on top of the shared baseline drift.
			const { dx, dy } = driftVector(i, level);

			// Paint the decaying ghost: faded, blurred, drifted off its anchor.
			const gx = word.x + dx;
			const gy = glyphTop + drift + dy;
			ctx.filter = blur > 0 ? `blur(${blur}px)` : "none";
			ctx.globalAlpha = alpha;
			ctx.fillStyle = tokens.fg;
			ctx.fillText(word.text, gx, gy);

			// Past half-decay, split the glyph into screen-blended red + cyan
			// copies so a chromatic fringe bleeds from the edges — crisp (no blur)
			// so the colour separation reads clearly, brighter as decay deepens.
			if (fringe > 0) {
				ctx.filter = "none";
				ctx.globalAlpha = 0.5 * level;
				ctx.globalCompositeOperation = "screen";
				ctx.fillStyle = "rgb(255,0,0)";
				ctx.fillText(word.text, gx + fringe, gy);
				ctx.fillStyle = "rgb(0,255,255)";
				ctx.fillText(word.text, gx - fringe, gy);
				ctx.globalCompositeOperation = "source-over";
			}
		}

		// Restore every touched default so the next frame's clear isn't filtered,
		// alpha'd, or composited under a stale blend mode.
		ctx.filter = "none";
		ctx.globalAlpha = 1;
		ctx.globalCompositeOperation = "source-over";
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
