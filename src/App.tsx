import { Editor } from "./components/Editor";
import { useDecayEvents } from "./hooks/useDecayEvents";
import "./styles/app.css";

// Phase 0 shell: the editor plus a small live decay readout so the 10 Hz event
// stream and keystroke resets are visible without opening devtools. The Canvas
// overlay (Phase 1) and stats/settings panels (Phase 2-3) mount here later.
function App() {
	const decay = useDecayEvents();

	return (
		<main className="app">
			<header className="app__bar">
				<span className="app__title">Pressfield</span>
				<span className="app__readout">
					{decay
						? `level ${decay.level.toFixed(2)} · idle ${decay.ms_idle}ms · ${decay.intensity}`
						: "awaiting decay…"}
				</span>
			</header>
			<Editor />
		</main>
	);
}

export default App;
