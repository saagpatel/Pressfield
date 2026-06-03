import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { type DecayUpdate, isDecayUpdate } from "../types/ipc";

// Subscribe to the Rust `decay-update` event stream.
//
// Phase 0: narrow the payload, expose the latest snapshot, and log it. Phase 1
// adds requestAnimationFrame interpolation to drive the Canvas overlay.
export function useDecayEvents(): DecayUpdate | null {
	const [latest, setLatest] = useState<DecayUpdate | null>(null);

	useEffect(() => {
		let off: UnlistenFn | undefined;
		let cancelled = false;

		listen<unknown>("decay-update", (event) => {
			if (isDecayUpdate(event.payload)) {
				setLatest(event.payload);
				console.log("decay-update", event.payload);
			}
		}).then((fn) => {
			// Unmounted before listen() resolved → detach immediately (no leak).
			if (cancelled) fn();
			else off = fn;
		});

		return () => {
			cancelled = true;
			off?.();
		};
	}, []);

	return latest;
}
