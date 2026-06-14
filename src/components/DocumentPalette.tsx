import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DocumentMeta } from "../types/ipc";
import { fuzzyFilter } from "../utils/fuzzyFilter";
import "../styles/palette.css";

interface DocumentPaletteProps {
	open: boolean;
	// The doc currently in the editor, so the palette can mark it and handle
	// deletion of the active doc by switching away first.
	activeDocId: number | null;
	// App owns the heavy switch (flush autosave → end session → hydrate → repoint).
	// Returns a promise so deletion of the active doc can await the switch-away
	// before removing it.
	onSwitch: (id: number) => void | Promise<void>;
	onClose: () => void;
}

// Cmd+O command palette for named documents. Owns its own list/create/rename/
// delete data ops (cheap, self-contained); switching is delegated to App because
// it must flush autosave and re-hydrate the editor. Keyboard-first: the writing
// surface stays pure and the palette vanishes on Enter/Esc.
export function DocumentPalette({
	open,
	activeDocId,
	onSwitch,
	onClose,
}: DocumentPaletteProps) {
	const [documents, setDocuments] = useState<DocumentMeta[]>([]);
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState(0);
	const [renamingId, setRenamingId] = useState<number | null>(null);
	const [renameDraft, setRenameDraft] = useState("");
	const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
	const inputRef = useRef<HTMLInputElement | null>(null);

	const refresh = useCallback(async () => {
		try {
			setDocuments(await invoke<DocumentMeta[]>("list_documents"));
		} catch (err) {
			console.error("list_documents failed", err);
		}
	}, []);

	// Reset transient state and refresh the list each time the palette opens, then
	// move focus into the filter input.
	useEffect(() => {
		if (!open) return;
		setQuery("");
		setSelected(0);
		setRenamingId(null);
		setConfirmDeleteId(null);
		void refresh();
		// Focus after the overlay paints so the caret lands in the input.
		const id = requestAnimationFrame(() => inputRef.current?.focus());
		return () => cancelAnimationFrame(id);
	}, [open, refresh]);

	const filtered = fuzzyFilter(documents, query);
	// Keep the highlight in range as the filter narrows.
	const activeIndex = Math.min(selected, Math.max(filtered.length - 1, 0));

	const switchTo = useCallback(
		(id: number) => {
			onSwitch(id);
			onClose();
		},
		[onSwitch, onClose],
	);

	const createAndSwitch = useCallback(
		async (name: string) => {
			try {
				const id = await invoke<number>("create_document", { name });
				switchTo(id);
			} catch (err) {
				console.error("create_document failed", err);
			}
		},
		[switchTo],
	);

	const handleDelete = useCallback(
		async (id: number) => {
			const remaining = documents.filter((d) => d.id !== id);
			try {
				if (id === activeDocId) {
					// Move the editor fully off the doomed document BEFORE deleting it,
					// so the switch's flush/end-session target the live (surviving) doc.
					if (remaining.length > 0) {
						await onSwitch(remaining[0].id);
					} else {
						// Deleting the last document: seed a fresh one to land on.
						const fresh = await invoke<number>("create_document", {
							name: "Untitled",
						});
						await onSwitch(fresh);
					}
				}
				await invoke("delete_document", { id });
				setConfirmDeleteId(null);
				await refresh();
			} catch (err) {
				console.error("delete_document failed", err);
			}
		},
		[documents, activeDocId, onSwitch, refresh],
	);

	const commitRename = useCallback(
		async (id: number) => {
			const name = renameDraft.trim();
			if (name === "") {
				setRenamingId(null);
				return;
			}
			try {
				await invoke("rename_document", { id, name });
				setRenamingId(null);
				await refresh();
			} catch (err) {
				console.error("rename_document failed", err);
			}
		},
		[renameDraft, refresh],
	);

	if (!open) return null;

	const handleInputKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Escape") {
			event.preventDefault();
			onClose();
		} else if (event.key === "ArrowDown") {
			event.preventDefault();
			setSelected(Math.min(activeIndex + 1, Math.max(filtered.length - 1, 0)));
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			setSelected(Math.max(activeIndex - 1, 0));
		} else if (event.key === "Enter") {
			event.preventDefault();
			const target = filtered[activeIndex];
			if (target) {
				switchTo(target.id);
			} else if (query.trim() !== "") {
				void createAndSwitch(query.trim());
			}
		}
	};

	const showCreateHint = query.trim() !== "" && filtered.length === 0;

	return (
		<div className="palette-overlay" role="presentation" onMouseDown={onClose}>
			<div
				className="palette"
				role="dialog"
				aria-label="Open or create a document"
				aria-modal="true"
				onMouseDown={(e) => e.stopPropagation()}
			>
				<input
					ref={inputRef}
					className="palette__input"
					type="text"
					placeholder="Search documents, or type a name to create…"
					value={query}
					spellCheck={false}
					aria-label="Filter documents"
					onChange={(e) => {
						setQuery(e.target.value);
						setSelected(0);
					}}
					onKeyDown={handleInputKey}
				/>

				<ul className="palette__list" role="listbox" aria-label="Documents">
					{filtered.map((doc, i) => {
						const isActive = doc.id === activeDocId;
						const isHighlighted = i === activeIndex;
						const isRenaming = doc.id === renamingId;
						const isConfirming = doc.id === confirmDeleteId;
						return (
							<li
								key={doc.id}
								className={`palette__item${
									isHighlighted ? " palette__item--highlight" : ""
								}`}
								role="option"
								aria-selected={isHighlighted}
							>
								{isRenaming ? (
									<input
										// biome-ignore lint/a11y/noAutofocus: focus belongs on the rename field the instant it opens
										autoFocus
										className="palette__rename"
										value={renameDraft}
										aria-label={`Rename ${doc.name}`}
										onChange={(e) => setRenameDraft(e.target.value)}
										onKeyDown={(e) => {
											if (e.key === "Enter") {
												e.preventDefault();
												void commitRename(doc.id);
											} else if (e.key === "Escape") {
												e.preventDefault();
												setRenamingId(null);
											}
										}}
										onBlur={() => void commitRename(doc.id)}
									/>
								) : (
									<button
										type="button"
										className="palette__name"
										onClick={() => switchTo(doc.id)}
									>
										<span className="palette__name-text">{doc.name}</span>
										{isActive ? (
											<span className="palette__badge">current</span>
										) : null}
									</button>
								)}

								<div className="palette__actions">
									{isConfirming ? (
										<>
											<button
												type="button"
												className="palette__action palette__action--danger"
												onClick={() => void handleDelete(doc.id)}
											>
												Delete
											</button>
											<button
												type="button"
												className="palette__action"
												onClick={() => setConfirmDeleteId(null)}
											>
												Cancel
											</button>
										</>
									) : (
										<>
											<button
												type="button"
												className="palette__action"
												aria-label={`Rename ${doc.name}`}
												onClick={() => {
													setRenamingId(doc.id);
													setRenameDraft(doc.name);
												}}
											>
												Rename
											</button>
											<button
												type="button"
												className="palette__action"
												aria-label={`Delete ${doc.name}`}
												onClick={() => setConfirmDeleteId(doc.id)}
											>
												Delete
											</button>
										</>
									)}
								</div>
							</li>
						);
					})}

					{showCreateHint ? (
						<li className="palette__create" role="option" aria-selected="false">
							<button
								type="button"
								className="palette__name"
								onClick={() => void createAndSwitch(query.trim())}
							>
								Create “{query.trim()}”
							</button>
						</li>
					) : null}
				</ul>

				<footer className="palette__footer">
					<span>↑↓ navigate</span>
					<span>↵ open{showCreateHint ? " / create" : ""}</span>
					<span>esc close</span>
				</footer>
			</div>
		</div>
	);
}
