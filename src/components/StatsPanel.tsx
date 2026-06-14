import { type RefObject, useEffect, useState } from "react";
import type { SessionStats } from "../types/ipc";

interface StatsPanelProps {
	// Live word count, computed on the frontend from the editor text.
	words: number;
	// Active-session aggregates from the backend poll (decay events, started_at).
	stats: SessionStats | null;
	// Recent sessions for the history table.
	history: SessionStats[];
	// Editor element, read on demand for the clean-text export.
	editorRef: RefObject<HTMLDivElement | null>;
}

// Format an elapsed-millisecond span as m:ss. Pure + exported for unit tests.
export function formatElapsed(ms: number): string {
	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

// Bottom stats bar: live word count, recovered decay events, elapsed session
// time (ticks locally), a clean-text export, and the recent-session history.
export function StatsPanel({
	words,
	stats,
	history,
	editorRef,
}: StatsPanelProps) {
	// Tick once a second so elapsed time advances between backend polls.
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), 1_000);
		return () => clearInterval(id);
	}, []);

	const elapsed = stats ? formatElapsed(now - stats.started_at) : "0:00";

	// Export the underlying prose — the editor's innerText, never the decayed
	// Canvas overlay. Stays in the webview (navigator.clipboard); Rust never
	// sees the text, upholding the zero-prose-to-backend contract.
	const copyClean = () => {
		const text = editorRef.current?.innerText ?? "";
		navigator.clipboard
			.writeText(text)
			.catch((err) => console.error("copy failed", err));
	};

	return (
		<aside className="stats" aria-label="Session stats">
			<div className="stats__live">
				<Stat label="words" value={words} />
				<Stat label="decay events" value={stats?.decay_events ?? 0} />
				<Stat label="elapsed" value={elapsed} />
				<button type="button" className="stats__copy" onClick={copyClean}>
					Copy clean text
				</button>
			</div>
			{history.length > 0 && (
				<table className="stats__history">
					<thead>
						<tr>
							<th>started</th>
							<th>words</th>
							<th>decay</th>
							<th>mode</th>
						</tr>
					</thead>
					<tbody>
						{history.map((session) => (
							<tr key={session.session_id}>
								<td>{new Date(session.started_at).toLocaleString()}</td>
								<td>{session.word_count}</td>
								<td>{session.decay_events}</td>
								<td>{session.intensity}</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
		</aside>
	);
}

function Stat({ label, value }: { label: string; value: number | string }) {
	return (
		<span className="stat">
			<span className="stat__value">{value}</span>
			<span className="stat__label">{label}</span>
		</span>
	);
}
