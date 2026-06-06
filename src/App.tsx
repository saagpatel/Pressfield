import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useMemo, useRef, useState } from "react";
import { DecayCanvas } from "./components/DecayCanvas";
import { Editor } from "./components/Editor";
import { SettingsPanel } from "./components/SettingsPanel";
import { StatsPanel } from "./components/StatsPanel";
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
					await invoke("end_session", {
						sessionId,
						wordCount: wordsRef.current,
					});
				} catch (err) {
					console.error("end_session failed", err);
				} finally {
					await appWindow.destroy();
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
