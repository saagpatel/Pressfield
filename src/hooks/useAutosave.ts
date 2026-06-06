import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef } from "react";

// Debounce window: long enough to coalesce a burst of typing into one write,
// short enough that a crash loses at most this much prose.
const AUTOSAVE_DEBOUNCE_MS = 750;

export interface Autosave {
	// Persist the latest text now, skipping the write if nothing changed since
	// the last save. The close handler awaits this before tearing down.
	flush: () => Promise<void>;
	// Seed the last-saved baseline (called once after hydration) so the editor's
	// initial body isn't redundantly re-written on launch.
	markSaved: (body: string) => void;
}

// Persist `text` to `documentId` on a debounce, on window blur, and on demand.
// Decay is a Canvas-overlay effect only — `text` is always the clean prose, so
// autosave never persists a distorted snapshot.
export function useAutosave(documentId: number | null, text: string): Autosave {
	// Latest text, read inside the debounce/flush without re-subscribing on it.
	const latest = useRef(text);
	latest.current = text;
	// Last successfully persisted body; `null` means "nothing saved yet".
	const saved = useRef<string | null>(null);

	const flush = useCallback(async () => {
		if (documentId === null) return;
		const body = latest.current;
		if (body === saved.current) return; // no change since last write
		try {
			await invoke("save_document", { id: documentId, body });
			saved.current = body;
		} catch (err) {
			console.error("save_document failed", err);
		}
	}, [documentId]);

	const markSaved = useCallback((body: string) => {
		saved.current = body;
	}, []);

	// Debounced autosave: each edit restarts the timer.
	useEffect(() => {
		if (documentId === null) return;
		const id = setTimeout(() => {
			void flush();
		}, AUTOSAVE_DEBOUNCE_MS);
		return () => clearTimeout(id);
	}, [text, documentId, flush]);

	// Flush when the window loses focus — cheap insurance against losing the
	// in-flight debounce if the user switches away.
	useEffect(() => {
		const onBlur = () => {
			void flush();
		};
		window.addEventListener("blur", onBlur);
		return () => window.removeEventListener("blur", onBlur);
	}, [flush]);

	return { flush, markSaved };
}
