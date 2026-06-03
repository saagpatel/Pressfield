// DOM geometry for the decay overlay. Walks the editor's text nodes and
// measures each word's live bounding box via a Range, mapped into the canvas's
// local coordinate space. Re-run every frame so scroll, resize, and zoom are
// tracked without caching (the IMPLEMENTATION-PLAN §1b mitigation for drift).

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
