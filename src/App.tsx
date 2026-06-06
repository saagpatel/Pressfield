import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useMemo, useRef, useState } from "react";
import { DecayCanvas } from "./components/DecayCanvas";
import { Editor } from "./components/Editor";
import { SettingsPanel } from "./components/SettingsPanel";
import { StatsPanel } from "./components/StatsPanel";
import { useActiveDocument } from "./hooks/useActiveDocument";
import { useAutosave } from "./hooks/useAutosave";
import { useDecayEvents } from "./hooks/useDecayEvents";
import { useSessionStats } from "./hooks/useSessionStats";
import { useTheme } from "./hooks/useTheme";
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
	const { stats, history } = useSessionStats(sessionId);

	// Hold the latest word count in a ref so the close handler (registered once)
	// reads the current value without re-registering on every keystroke.
	const wordsRef = useRef(0);
	wordsRef.current = words;

	// The document this launch opened; null until the backend fetch resolves.
	const activeDoc = useActiveDocument();
	// Gate autosave on hydration: pass a null target until the editor has been
	// hydrated, so a keystroke that races ahead of the launch fetch can never
	// overwrite the persisted body before we've loaded it.
	const [hydrated, setHydrated] = useState(false);
	const documentId = hydrated ? (activeDoc?.id ?? null) : null;
	const { flush: flushAutosave, markSaved } = useAutosave(documentId, text);

	// Mirror the latest flush into a ref so the close handler (registered once
	// against sessionId) always calls the current one without re-registering.
	const flushRef = useRef(flushAutosave);
	flushRef.current = flushAutosave;

	// Hydrate the editor from the saved body exactly once, when the active
	// document resolves — but never clobber anything the user managed to type
	// before the fetch landed. Seed the autosave baseline to the editor's actual
	// post-hydration content so it isn't redundantly re-written on launch.
	useEffect(() => {
		if (hydrated || activeDoc === null) return;
		const el = editorRef.current;
		if (el === null) return;
		if (el.innerText === "") {
			el.innerText = activeDoc.body;
			setText(activeDoc.body);
		}
		markSaved(el.innerText);
		setHydrated(true);
	}, [hydrated, activeDoc, markSaved]);

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
				<SettingsPanel current={intensity} />
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
		</main>
	);
}

export default App;
