import { type RefObject, useEffect, useRef } from "react";
import { DecayRenderer, type RenderTokens, readTokens } from "../canvas/decay";
import { WordBoxCache } from "../canvas/wordBoxes";

interface DecayCanvasProps {
	editorRef: RefObject<HTMLDivElement | null>;
	sampleLevel: (now: number) => number;
}

// Absolute overlay above the editor. Owns the requestAnimationFrame render loop;
// reads live word geometry each frame and hands it to the DecayRenderer.
// pointer-events:none (in CSS) so every click and keystroke reaches the editor.
export function DecayCanvas({ editorRef, sampleLevel }: DecayCanvasProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		const editor = editorRef.current;
		if (!canvas || !editor) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		const renderer = new DecayRenderer();
		const cache = new WordBoxCache();
		const invalidate = () => cache.invalidate();
		let tokens: RenderTokens = readTokens(editor);
		let dpr = window.devicePixelRatio || 1;

		const resize = () => {
			dpr = window.devicePixelRatio || 1;
			const rect = canvas.getBoundingClientRect();
			canvas.width = Math.max(1, Math.round(rect.width * dpr));
			canvas.height = Math.max(1, Math.round(rect.height * dpr));
			tokens = readTokens(editor); // font/colours can shift with theme or zoom
			invalidate(); // canvas geometry moved → word boxes must be re-measured
		};
		resize();

		const observer = new ResizeObserver(resize);
		observer.observe(canvas);
		// Browser zoom changes devicePixelRatio without resizing the canvas's CSS
		// box, so the ResizeObserver alone can miss it — catch window resize too.
		window.addEventListener("resize", resize);

		// Re-measure only when the text or its layout actually changes: edits and
		// paste/undo (MutationObserver) or the editor scrolling. Between these the
		// cached boxes are reused, so idle decay frames do zero layout reflow.
		const mutations = new MutationObserver(invalidate);
		mutations.observe(editor, {
			childList: true,
			characterData: true,
			subtree: true,
		});
		editor.addEventListener("scroll", invalidate);

		// Re-read the colour tokens when the theme flips (data-theme on <html>),
		// so the overlay's occlusion + fringe re-tint to the new palette. Watching
		// the attribute directly avoids any cross-component effect-ordering race.
		const themeObserver = new MutationObserver(() => {
			tokens = readTokens(editor);
		});
		themeObserver.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["data-theme"],
		});

		let raf = 0;
		const frame = () => {
			const level = sampleLevel(performance.now());
			const words = cache.boxes(editor, canvas.getBoundingClientRect());
			renderer.render(ctx, level, words, tokens, dpr);
			raf = requestAnimationFrame(frame);
		};
		raf = requestAnimationFrame(frame);

		return () => {
			cancelAnimationFrame(raf);
			observer.disconnect();
			mutations.disconnect();
			themeObserver.disconnect();
			editor.removeEventListener("scroll", invalidate);
			window.removeEventListener("resize", resize);
		};
	}, [editorRef, sampleLevel]);

	return <canvas ref={canvasRef} className="decay-canvas" aria-hidden="true" />;
}
