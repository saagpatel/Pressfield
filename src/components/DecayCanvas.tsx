import { type RefObject, useEffect, useRef } from "react";
import { DecayRenderer, type RenderTokens, readTokens } from "../canvas/decay";
import { extractWordBoxes } from "../canvas/wordBoxes";

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
		let tokens: RenderTokens = readTokens(editor);
		let dpr = window.devicePixelRatio || 1;

		const resize = () => {
			dpr = window.devicePixelRatio || 1;
			const rect = canvas.getBoundingClientRect();
			canvas.width = Math.max(1, Math.round(rect.width * dpr));
			canvas.height = Math.max(1, Math.round(rect.height * dpr));
			tokens = readTokens(editor); // font/colours can shift with theme or zoom
		};
		resize();

		const observer = new ResizeObserver(resize);
		observer.observe(canvas);
		// Browser zoom changes devicePixelRatio without resizing the canvas's CSS
		// box, so the ResizeObserver alone can miss it — catch window resize too.
		window.addEventListener("resize", resize);

		let raf = 0;
		const frame = () => {
			const level = sampleLevel(performance.now());
			const words = extractWordBoxes(editor, canvas.getBoundingClientRect());
			renderer.render(ctx, level, words, tokens, dpr);
			raf = requestAnimationFrame(frame);
		};
		raf = requestAnimationFrame(frame);

		return () => {
			cancelAnimationFrame(raf);
			observer.disconnect();
			window.removeEventListener("resize", resize);
		};
	}, [editorRef, sampleLevel]);

	return <canvas ref={canvasRef} className="decay-canvas" aria-hidden="true" />;
}
