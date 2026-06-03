import { useRef } from "react";
import { DecayCanvas } from "./components/DecayCanvas";
import { Editor } from "./components/Editor";
import { useDecayEvents } from "./hooks/useDecayEvents";
import "./styles/app.css";

// Phase 1 shell: the editor, the Canvas decay overlay above it, and a live
// readout. The editor ref is shared so the overlay can read word geometry.
function App() {
	const editorRef = useRef<HTMLDivElement | null>(null);
	const { latest, sampleLevel } = useDecayEvents();

	return (
		<main className="app">
			<header className="app__bar">
				<span className="app__title">Pressfield</span>
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
