import { useRef } from "react";
import { DecayCanvas } from "./components/DecayCanvas";
import { Editor } from "./components/Editor";
import { SettingsPanel } from "./components/SettingsPanel";
import { useDecayEvents } from "./hooks/useDecayEvents";
import "./styles/app.css";

// App shell: the editor, the Canvas decay overlay above it, a live readout, and
// the intensity selector. The editor ref is shared so the overlay can read word
// geometry; intensity flows from the decay stream (Rust holds the source state).
function App() {
	const editorRef = useRef<HTMLDivElement | null>(null);
	const { latest, sampleLevel } = useDecayEvents();
	const intensity = latest?.intensity ?? "normal";

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
			</header>
			<div className="surface">
				<Editor ref={editorRef} />
				<DecayCanvas editorRef={editorRef} sampleLevel={sampleLevel} />
			</div>
		</main>
	);
}

export default App;
