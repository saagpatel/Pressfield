import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import type { Intensity } from "../types/ipc";

const OPTIONS: { value: Intensity; label: string; hint: string }[] = [
	{ value: "gentle", label: "Gentle", hint: "8s" },
	{ value: "normal", label: "Normal", hint: "5s" },
	{ value: "brutal", label: "Brutal", hint: "2s" },
];

interface SettingsPanelProps {
	// Current intensity, read back from the decay stream (Rust is authoritative).
	current: Intensity;
	// The live session id; intensity is persisted on it (changes on doc switch).
	sessionId: number | null;
	// Whether hardcore mode is on (global, read back from Rust at launch).
	hardcore: boolean;
	// Apply a hardcore on/off change (App persists it via `set_hardcore`).
	onHardcoreChange: (enabled: boolean) => void;
}

// Intensity selector + the hardcore-mode toggle. Intensity writes through to Rust
// `set_intensity`; hardcore is gated behind a confirm dialog on enable because it
// makes decay permanently destroy text. The checked states reflect backend
// values, so the controls mirror real state rather than optimistic UI.
export function SettingsPanel({
	current,
	sessionId,
	hardcore,
	onHardcoreChange,
}: SettingsPanelProps) {
	const choose = (intensity: Intensity) => {
		if (sessionId === null) return;
		invoke("set_intensity", { sessionId, intensity }).catch((err) =>
			console.error("set_intensity failed", err),
		);
	};

	// Enabling hardcore is gated: clicking the box opens a confirm dialog and the
	// flag only flips on confirm. Disabling is immediate (de-escalation is safe).
	const [confirming, setConfirming] = useState(false);

	const onToggle = (event: React.ChangeEvent<HTMLInputElement>) => {
		if (event.target.checked) setConfirming(true);
		else onHardcoreChange(false);
	};

	const confirmEnable = () => {
		setConfirming(false);
		onHardcoreChange(true);
	};

	// Escape cancels the confirm dialog without enabling.
	useEffect(() => {
		if (!confirming) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setConfirming(false);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [confirming]);

	return (
		<div className="settings">
			<fieldset className="settings__group" aria-label="Decay intensity">
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

			<label
				className="settings__hardcore"
				title="Permanent text loss past full decay"
			>
				<input
					type="checkbox"
					className="settings__hardcore-box"
					checked={hardcore}
					onChange={onToggle}
					aria-label="Hardcore mode — permanent text loss past full decay"
				/>
				<span className="settings__name">Hardcore</span>
				<span className="settings__hint">{hardcore ? "on" : "off"}</span>
			</label>

			{confirming && (
				<div
					className="confirm-overlay"
					role="dialog"
					aria-modal="true"
					aria-labelledby="confirm-hardcore-title"
				>
					<div className="confirm">
						<h2 id="confirm-hardcore-title" className="confirm__title">
							Enable hardcore mode?
						</h2>
						<p className="confirm__body">
							Past full decay, Pressfield will{" "}
							<strong>permanently destroy</strong> the trailing words of your
							document — one bite at a time, until you type. Destroyed text
							cannot be recovered.
						</p>
						<div className="confirm__actions">
							<button
								type="button"
								className="confirm__btn"
								onClick={() => setConfirming(false)}
							>
								Cancel
							</button>
							{/* biome-ignore lint/a11y/noAutofocus: confirm dialogs should
							    focus their primary action so Enter/Esc work immediately. */}
							<button
								type="button"
								className="confirm__btn confirm__btn--danger"
								onClick={confirmEnable}
								autoFocus
							>
								Enable
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
