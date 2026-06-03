import { invoke } from "@tauri-apps/api/core";
import { type Ref, useEffect, useState } from "react";

interface EditorProps {
	ref?: Ref<HTMLDivElement>;
}

// Bare contenteditable surface. Every keystroke resets the Rust idle timer via
// `record_keystroke`. The Canvas overlay (a sibling in App) reads this element's
// geometry through `ref`. The prose lives only in the DOM and never reaches Rust.
export function Editor({ ref }: EditorProps) {
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
		/>
	);
}
