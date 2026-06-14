import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { type DecayUpdate, isDecayUpdate } from "../types/ipc";
import { type LevelSample, projectLevel } from "../utils/decayMath";

export interface DecayStream {
	// Latest raw event — drives the header readout (~10 Hz state updates).
	latest: DecayUpdate | null;
	// Interpolated level at time `now` (performance.now ms) for the 60 fps Canvas.
	sampleLevel: (now: number) => number;
}

// Subscribe to the Rust `decay-update` stream. Keeps a two-sample ref buffer so
// the Canvas can extrapolate between 10 Hz ticks without re-rendering React.
export function useDecayEvents(): DecayStream {
	const [latest, setLatest] = useState<DecayUpdate | null>(null);
	const samples = useRef<LevelSample[]>([]); // up to 2, ascending t

	useEffect(() => {
		let off: UnlistenFn | undefined;
		let cancelled = false;

		listen<unknown>("decay-update", (event) => {
			if (!isDecayUpdate(event.payload)) return;
			const sample: LevelSample = {
				level: event.payload.level,
				t: performance.now(),
			};
			const buf = samples.current;
			const prev = buf[buf.length - 1];
			if (prev && sample.level < prev.level) {
				// Decay dropped (keystroke reset) → snap; never interpolate downward,
				// so a keystroke clears the overlay within one frame.
				samples.current = [sample];
			} else {
				samples.current = [...buf, sample].slice(-2);
			}
			setLatest(event.payload);
		}).then((fn) => {
			if (cancelled) fn();
			else off = fn;
		});

		return () => {
			cancelled = true;
			off?.();
		};
	}, []);

	const sampleLevel = useCallback((now: number) => {
		const buf = samples.current;
		return projectLevel(buf[buf.length - 2], buf[buf.length - 1], now);
	}, []);

	return { latest, sampleLevel };
}
