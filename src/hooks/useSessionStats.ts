import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import type { SessionStats } from "../types/ipc";

// Backend is polled at this cadence; the elapsed-time readout ticks locally in
// the panel so the clock stays smooth between polls.
const POLL_MS = 5_000;

export interface SessionStatsView {
	// Active session aggregates (decay events, started_at, persisted word count).
	stats: SessionStats | null;
	// Most-recent sessions, newest first, for the history table.
	history: SessionStats[];
}

// Poll the active session's stats + the active document's recent-session history.
// Rust owns the source data; this is a read-only view that refreshes every
// POLL_MS. History is per-document, so switching documents repoints it.
export function useSessionStats(
	sessionId: number | null,
	documentId: number | null,
): SessionStatsView {
	const [stats, setStats] = useState<SessionStats | null>(null);
	const [history, setHistory] = useState<SessionStats[]>([]);

	useEffect(() => {
		if (sessionId === null) return;
		let cancelled = false;

		const poll = () => {
			invoke<SessionStats>("get_stats", { sessionId })
				.then((s) => !cancelled && setStats(s))
				.catch((err) => console.error("get_stats failed", err));
			if (documentId !== null) {
				invoke<SessionStats[]>("get_recent_document_sessions", {
					documentId,
					limit: 10,
				})
					.then((h) => !cancelled && setHistory(h))
					.catch((err) =>
						console.error("get_recent_document_sessions failed", err),
					);
			}
		};

		poll(); // prime immediately so the panel isn't empty for 5s
		const id = setInterval(poll, POLL_MS);
		return () => {
			cancelled = true;
			clearInterval(id);
		};
	}, [sessionId, documentId]);

	return { stats, history };
}
