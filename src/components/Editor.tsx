import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

// Bare contenteditable surface. Every keystroke resets the Rust idle timer via
// `record_keystroke`. No decay rendering here — the Canvas overlay lands in
// Phase 1. The prose lives only in the DOM and is never sent to Rust.
export function Editor() {
	const [sessionId, setSessionId] = useState<number | null>(null);

	useEffect(() => {
		let cancelled = false;
		invoke<number>("get_active_session_id")
			.then((id) => {
				if (!cancelled) setSessionId(id);
			})
			.catch((err) => console.error("get_active_session_id failed", err));
		return () => {
			cancelled = true;
		};
	}, []);

	function handleKeyDown() {
		if (sessionId === null) return;
		// camelCase `sessionId` maps to the Rust `session_id` param (Tauri default).
		invoke("record_keystroke", { sessionId }).catch((err) =>
			console.error("record_keystroke failed", err),
		);
	}

	return (
		<div
			className="editor"
			contentEditable
			suppressContentEditableWarning
			spellCheck={false}
			role="textbox"
			aria-label="Writing surface"
			aria-multiline="true"
			data-placeholder="Start writing. Don't stop."
			onKeyDown={handleKeyDown}
		/>
	);
}
