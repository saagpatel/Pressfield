// DOM geometry for the decay overlay. Walks the editor's text nodes and
// measures each word's live bounding box via a Range, mapped into the canvas's
// local coordinate space. The measurement forces a layout reflow, so the
// WordBoxCache below memoises it and only re-measures when the DecayCanvas
// observers report a change (DOM mutation, editor scroll, canvas resize).

export interface WordBox {
	text: string;
	x: number; // CSS px, relative to the canvas top-left
	y: number;
	w: number;
	h: number;
}

const WORD = /\S+/g;

export function extractWordBoxes(
	editor: HTMLElement,
	canvasRect: DOMRect,
): WordBox[] {
	const boxes: WordBox[] = [];
	const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
	const range = document.createRange();

	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		const text = node.nodeValue;
		if (!text) continue;
		WORD.lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = WORD.exec(text)) !== null) {
			range.setStart(node, match.index);
			range.setEnd(node, match.index + match[0].length);
			const rect = range.getBoundingClientRect();
			if (rect.width === 0 && rect.height === 0) continue;
			boxes.push({
				text: match[0],
				x: rect.left - canvasRect.left,
				y: rect.top - canvasRect.top,
				w: rect.width,
				h: rect.height,
			});
		}
	}
	return boxes;
}

type Extractor = (editor: HTMLElement, canvasRect: DOMRect) => WordBox[];

// Memoises word-box extraction so the render loop stops forcing a layout reflow
// on every animation frame. Phase 1 re-measured every frame (correct but a
// per-RAF reflow during idle decay); this serves a cached result and only
// re-measures after `invalidate()`. The DecayCanvas wires invalidation to a
// MutationObserver (paste/undo/edits), the editor scroll event, and resize.
export class WordBoxCache {
	private cached: WordBox[] = [];
	private dirty = true;

	// `extract` is injectable so tests can drive the dirty logic without a DOM.
	constructor(private readonly extract: Extractor = extractWordBoxes) {}

	// Mark the cache stale; the next boxes() call re-measures.
	invalidate(): void {
		this.dirty = true;
	}

	// Current word boxes, re-measuring only when stale.
	boxes(editor: HTMLElement, canvasRect: DOMRect): readonly WordBox[] {
		if (this.dirty) {
			this.cached = this.extract(editor, canvasRect);
			this.dirty = false;
		}
		return this.cached;
	}
}
