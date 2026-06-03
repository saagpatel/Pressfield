import { invoke } from "@tauri-apps/api/core";
import type { Intensity } from "../types/ipc";

const OPTIONS: { value: Intensity; label: string; hint: string }[] = [
	{ value: "gentle", label: "Gentle", hint: "8s" },
	{ value: "normal", label: "Normal", hint: "5s" },
	{ value: "brutal", label: "Brutal", hint: "2s" },
];

interface SettingsPanelProps {
	// Current intensity, read back from the decay stream (Rust is authoritative).
	current: Intensity;
}

// Intensity selector. Writes through to Rust `set_intensity`, which retunes the
// idle timer and persists the choice on the active session row. The checked
// state reflects the backend value carried on the next decay-update event, so
// the control always mirrors the real decay rate rather than optimistic state.
export function SettingsPanel({ current }: SettingsPanelProps) {
	const choose = (intensity: Intensity) => {
		invoke("set_intensity", { intensity }).catch((err) =>
			console.error("set_intensity failed", err),
		);
	};

	return (
		<fieldset className="settings" aria-label="Decay intensity">
			<legend className="settings__legend">Intensity</legend>
			<div className="settings__options">
				{OPTIONS.map((opt) => (
					<label
						key={opt.value}
						className={`settings__option${
							current === opt.value ? " settings__option--active" : ""
						}`}
					>
						<input
							type="radio"
							name="intensity"
							value={opt.value}
							checked={current === opt.value}
							onChange={() => choose(opt.value)}
							className="settings__radio"
						/>
						<span className="settings__name">{opt.label}</span>
						<span className="settings__hint">{opt.hint}</span>
					</label>
				))}
			</div>
		</fieldset>
	);
}
