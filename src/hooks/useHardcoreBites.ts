import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { type RefObject, useEffect, useRef } from "react";
import { isDecayBite } from "../types/ipc";
import { BITE_FRACTION, removeTrailingWords } from "../utils/destruction";

interface HardcoreBitesArgs {
	// The contenteditable surface to destroy text from.
	editorRef: RefObject<HTMLDivElement | null>;
	// The live document; null until hydrated. A bite never fires without one.
	documentId: number | null;
	// Sync the surviving body back into React state + the autosave baseline so a
	// debounced autosave can't re-write a stale (pre-bite) body over the corpse.
	onDestroyed: (body: string) => void;
}

// Collapse the caret to the end of the editor after a destructive replacement,
// so the selection doesn't dangle over text that no longer exists.
function collapseCaretToEnd(el: HTMLElement): void {
	const sel = window.getSelection();
	if (sel === null) return;
	const range = document.createRange();
	range.selectNodeContents(el);
	range.collapse(false);
	sel.removeAllRanges();
	sel.addRange(range);
}

// Subscribe to the Rust `decay-bite` stream. Rust emits a bite only while
// hardcore is on, the window is focused, and decay is held at full — so by the
// time an event arrives, destruction is already authorized. Each bite:
//   1. removes the trailing BITE_FRACTION of words from the editor (in place),
//   2. flushes the corpse to SQLite SYNCHRONOUSLY — never the 750ms autosave
//      debounce, or a crash between bite and debounce would resurrect the words,
//   3. syncs React/autosave state to the survivor.
//
// Replacing the editor's child tree avoids browser edit commands and reduces the
// chance of native undo treating the bite as a recoverable edit. A 2026-06-07
// Tauri validation confirmed Edit > Undo did not restore a bitten tail.
export function useHardcoreBites({
	editorRef,
	documentId,
	onDestroyed,
}: HardcoreBitesArgs): void {
	// Latest documentId/onDestroyed in refs so the listener subscribes once and
	// still reads current values (re-subscribing per render would drop events).
	const docRef = useRef(documentId);
	docRef.current = documentId;
	const onDestroyedRef = useRef(onDestroyed);
	onDestroyedRef.current = onDestroyed;

	useEffect(() => {
		let off: UnlistenFn | undefined;
		let cancelled = false;

		listen<unknown>("decay-bite", async (event) => {
			if (!isDecayBite(event.payload)) return;
			const el = editorRef.current;
			const id = docRef.current;
			if (el === null || id === null) return;

			const before = el.innerText;
			const after = removeTrailingWords(before, BITE_FRACTION);
			if (after === before) return; // empty doc: nothing left to destroy

			// Destroy in place without going through an editable command path, then
			// reanchor the caret.
			el.replaceChildren(document.createTextNode(after));
			collapseCaretToEnd(el);
			// Sync React state + autosave baseline to the survivor first, so even if
			// the flush below throws, autosave won't re-write the pre-bite body.
			onDestroyedRef.current(after);

			try {
				await invoke("save_document", { id, body: after });
			} catch (err) {
				console.error("bite flush save_document failed", err);
			}
		}).then((fn) => {
			if (cancelled) fn();
			else off = fn;
		});

		return () => {
			cancelled = true;
			off?.();
		};
	}, [editorRef]);
}
