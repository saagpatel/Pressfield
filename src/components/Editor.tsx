import { invoke } from "@tauri-apps/api/core";
import type { Ref } from "react";

interface EditorProps {
	ref?: Ref<HTMLDivElement>;
	// The active session id, owned by App; null until the launch fetch resolves.
	sessionId: number | null;
	// Surfaces the live plain text on every edit so App can keep a word count.
	onTextChange: (text: string) => void;
}

// Bare contenteditable surface. Every keystroke resets the Rust idle timer via
// `record_keystroke`; every edit surfaces the plain text for the live word
// count. The Canvas overlay (a sibling in App) reads this element's geometry
// through `ref`. The prose lives only in the DOM and never reaches Rust.
export function Editor({ ref, sessionId, onTextChange }: EditorProps) {
	function handleKeyDown() {
		if (sessionId === null) return;
		// camelCase `sessionId` maps to the Rust `session_id` param (Tauri default).
		invoke("record_keystroke", { sessionId }).catch((err) =>
			console.error("record_keystroke failed", err),
		);
	}

	return (
		<div
			ref={ref}
			className="editor"
			contentEditable
			suppressContentEditableWarning
			spellCheck={false}
			role="textbox"
			aria-label="Writing surface"
			aria-multiline="true"
			data-placeholder="Start writing. Don't stop."
			onKeyDown={handleKeyDown}
			onInput={(event) => onTextChange(event.currentTarget.innerText)}
		/>
	);
}
