import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DecayCanvas } from "./components/DecayCanvas";
import { DocumentPalette } from "./components/DocumentPalette";
import { Editor } from "./components/Editor";
import { SettingsPanel } from "./components/SettingsPanel";
import { StatsPanel } from "./components/StatsPanel";
import { useActiveDocument } from "./hooks/useActiveDocument";
import { useAutosave } from "./hooks/useAutosave";
import { useDecayEvents } from "./hooks/useDecayEvents";
import { useSessionStats } from "./hooks/useSessionStats";
import { useTheme } from "./hooks/useTheme";
import type { DocumentRecord } from "./types/ipc";
import "./styles/app.css";
import { wordCount } from "./utils/wordCount";

// App shell: editor + Canvas decay overlay, the intensity selector, a live decay
// readout, and the session stats bar. App owns the session id and the live word
// count, so the editor, stats panel, and the on-close finalize all share them.
function App() {
	const editorRef = useRef<HTMLDivElement | null>(null);
	const { latest, sampleLevel } = useDecayEvents();
	const intensity = latest?.intensity ?? "normal";
	const { theme, toggle: toggleTheme } = useTheme();

	const [sessionId, setSessionId] = useState<number | null>(null);
	// The document currently in the editor — set at launch hydration, changed on
	// a palette switch. Null until hydrated, which also gates autosave.
	const [activeDocId, setActiveDocId] = useState<number | null>(null);
	const [paletteOpen, setPaletteOpen] = useState(false);
	const [text, setText] = useState("");
	// Debounce the text before counting: Intl.Segmenter over the full document is
	// O(n), so running it on every keystroke would jank long-form writing. The
	// word readout doesn't need per-keystroke precision.
	const [debouncedText, setDebouncedText] = useState("");
	useEffect(() => {
		const id = setTimeout(() => setDebouncedText(text), 250);
		return () => clearTimeout(id);
	}, [text]);
	const words = useMemo(() => wordCount(debouncedText), [debouncedText]);
	const { stats, history } = useSessionStats(sessionId, activeDocId);

	// Hold the latest word count in a ref so the close handler (registered once)
	// reads the current value without re-registering on every keystroke.
	const wordsRef = useRef(0);
	wordsRef.current = words;

	// The document this launch opened; null until the backend fetch resolves.
	const launchDoc = useActiveDocument();
	// Autosave targets the live document; `activeDocId` is null until hydrated,
	// which gates autosave so a keystroke racing ahead of the launch fetch can
	// never overwrite the persisted body before we've loaded it.
	const { flush: flushAutosave, markSaved } = useAutosave(activeDocId, text);

	// Mirror the latest flush into a ref so the close handler (registered once
	// against sessionId) always calls the current one without re-registering.
	const flushRef = useRef(flushAutosave);
	flushRef.current = flushAutosave;

	// Hydrate the editor from the launch document's body exactly once — but never
	// clobber anything the user typed before the fetch landed. Seeding the
	// autosave baseline keeps the untouched body from being re-written on launch.
	const [hydrated, setHydrated] = useState(false);
	useEffect(() => {
		if (hydrated || launchDoc === null) return;
		const el = editorRef.current;
		if (el === null) return;
		if (el.innerText === "") {
			el.innerText = launchDoc.body;
			setText(launchDoc.body);
		}
		markSaved(el.innerText);
		setActiveDocId(launchDoc.id);
		setHydrated(true);
	}, [hydrated, launchDoc, markSaved]);

	// Serialize switches: a switch is a multi-await chain (flush → end → start →
	// hydrate → repoint), and two overlapping runs would double-finalize a session
	// and race the editor into a half-switched state. Ignore a switch while one
	// is already in flight.
	const switchingRef = useRef(false);

	// Switch the editor to another document: persist + finalize the outgoing one,
	// then start a session for the incoming one and hydrate it from its body.
	const switchDocument = useCallback(
		async (targetId: number) => {
			if (switchingRef.current || targetId === activeDocId) return;
			switchingRef.current = true;
			try {
				await flushRef.current();
				if (sessionId !== null) {
					try {
						await invoke("end_session", {
							sessionId,
							wordCount: wordsRef.current,
						});
					} catch (err) {
						console.error("end_session on switch failed", err);
					}
				}
				const newSessionId = await invoke<number>("start_document_session", {
					documentId: targetId,
				});
				const doc = await invoke<DocumentRecord>("get_document", {
					id: targetId,
				});
				const el = editorRef.current;
				if (el !== null) el.innerText = doc.body;
				setText(doc.body);
				markSaved(doc.body);
				setSessionId(newSessionId);
				setActiveDocId(targetId);
			} catch (err) {
				console.error("switch document failed", err);
			} finally {
				switchingRef.current = false;
			}
		},
		[activeDocId, sessionId, markSaved],
	);

	// Cmd/Ctrl+O opens the document palette.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "o") {
				e.preventDefault();
				setPaletteOpen(true);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	useEffect(() => {
		let cancelled = false;
		invoke<number>("get_active_session_id")
			.then((id) => !cancelled && setSessionId(id))
			.catch((err) => console.error("get_active_session_id failed", err));
		return () => {
			cancelled = true;
		};
	}, []);

	// Finalize the session when the window closes: hold the close, persist the
	// final word count, then destroy — so the write always completes.
	useEffect(() => {
		if (sessionId === null) return;
		let cancelled = false;
		let unlisten: (() => void) | undefined;
		const appWindow = getCurrentWindow();
		appWindow
			.onCloseRequested(async (event) => {
				event.preventDefault();
				try {
					// Persist the final prose, then finalize the session.
					await flushRef.current();
					await invoke("end_session", {
						sessionId,
						wordCount: wordsRef.current,
					});
				} catch (err) {
					console.error("close finalize failed", err);
				}
				// Always attempt teardown, even if finalize failed — preventDefault
				// suppressed the OS close, so destroy() is the only remaining exit.
				try {
					await appWindow.destroy();
				} catch (err) {
					console.error("window destroy failed", err);
				}
			})
			.then((fn) => {
				// If the effect was cleaned up before the listener resolved (e.g.
				// StrictMode remount), unlisten immediately so it never orphans.
				if (cancelled) fn();
				else unlisten = fn;
			})
			.catch((err) => console.error("onCloseRequested failed", err));
		return () => {
			cancelled = true;
			unlisten?.();
		};
	}, [sessionId]);

	return (
		<main className="app">
			<header className="app__bar">
				<span className="app__title">Pressfield</span>
				<SettingsPanel current={intensity} sessionId={sessionId} />
				<span className="app__readout">
					{latest
						? `level ${latest.level.toFixed(2)} · idle ${latest.ms_idle}ms · ${latest.intensity}`
						: "awaiting decay…"}
				</span>
				<button
					type="button"
					className="app__theme"
					onClick={toggleTheme}
					aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
				>
					{theme === "dark" ? "Light" : "Dark"}
				</button>
			</header>
			<div className="surface">
				<Editor ref={editorRef} sessionId={sessionId} onTextChange={setText} />
				<DecayCanvas editorRef={editorRef} sampleLevel={sampleLevel} />
			</div>
			<StatsPanel
				words={words}
				stats={stats}
				history={history}
				editorRef={editorRef}
			/>
			<DocumentPalette
				open={paletteOpen}
				activeDocId={activeDocId}
				onSwitch={switchDocument}
				onClose={() => setPaletteOpen(false)}
			/>
		</main>
	);
}

export default App;
