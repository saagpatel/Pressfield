import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import type { DocumentRecord } from "../types/ipc";

// Fetch the document the backend opened this launch, once on mount. `null` until
// it resolves; App hydrates the editor from `body` when it does.
export function useActiveDocument(): DocumentRecord | null {
	const [doc, setDoc] = useState<DocumentRecord | null>(null);

	useEffect(() => {
		let cancelled = false;
		invoke<DocumentRecord>("get_active_document")
			.then((d) => !cancelled && setDoc(d))
			.catch((err) => console.error("get_active_document failed", err));
		return () => {
			cancelled = true;
		};
	}, []);

	return doc;
}
