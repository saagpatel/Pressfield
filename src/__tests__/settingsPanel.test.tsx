// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type ConfirmationStore,
	HARDCORE_CONFIRM_KEY,
	SettingsPanel,
} from "../components/SettingsPanel";

type ActGlobal = typeof globalThis & {
	IS_REACT_ACT_ENVIRONMENT?: boolean;
};

(globalThis as ActGlobal).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

function makeConfirmationStore(): ConfirmationStore {
	const values = new Map<string, string>();
	return {
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => values.set(key, value),
	};
}

function renderPanel(
	props: Partial<React.ComponentProps<typeof SettingsPanel>> = {},
) {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const root = createRoot(host);
	roots.push(root);
	const onHardcoreChange = vi.fn();
	const confirmationStore = props.confirmationStore ?? makeConfirmationStore();
	act(() => {
		root.render(
			<SettingsPanel
				current="normal"
				sessionId={1}
				hardcore={false}
				onHardcoreChange={onHardcoreChange}
				confirmationStore={confirmationStore}
				{...props}
			/>,
		);
	});
	return { host, onHardcoreChange, confirmationStore };
}

function hardcoreBox(host: HTMLElement): HTMLInputElement {
	const el = host.querySelector<HTMLInputElement>(
		"input.settings__hardcore-box",
	);
	if (el === null) throw new Error("hardcore checkbox missing");
	return el;
}

function click(el: HTMLElement): void {
	act(() => el.click());
}

afterEach(() => {
	for (const root of roots.splice(0)) {
		act(() => root.unmount());
	}
	document.body.innerHTML = "";
	vi.restoreAllMocks();
});

describe("SettingsPanel hardcore confirmation", () => {
	it("opens the confirm dialog before first enable", () => {
		const { host, onHardcoreChange, confirmationStore } = renderPanel();

		click(hardcoreBox(host));

		expect(onHardcoreChange).not.toHaveBeenCalled();
		expect(host.querySelector('[role="dialog"]')).not.toBeNull();
		expect(confirmationStore.getItem(HARDCORE_CONFIRM_KEY)).toBeNull();
	});

	it("persists confirmation after explicit enable", () => {
		const { host, onHardcoreChange, confirmationStore } = renderPanel();

		click(hardcoreBox(host));
		const enable = [...host.querySelectorAll("button")].find(
			(button) => button.textContent === "Enable",
		);
		if (enable === undefined) throw new Error("enable button missing");
		click(enable);

		expect(onHardcoreChange).toHaveBeenCalledOnce();
		expect(onHardcoreChange).toHaveBeenCalledWith(true);
		expect(confirmationStore.getItem(HARDCORE_CONFIRM_KEY)).toBe("true");
		expect(host.querySelector('[role="dialog"]')).toBeNull();
	});

	it("skips the dialog after hardcore was already confirmed once", () => {
		const confirmationStore = makeConfirmationStore();
		confirmationStore.setItem(HARDCORE_CONFIRM_KEY, "true");
		const { host, onHardcoreChange } = renderPanel({ confirmationStore });

		click(hardcoreBox(host));

		expect(onHardcoreChange).toHaveBeenCalledOnce();
		expect(onHardcoreChange).toHaveBeenCalledWith(true);
		expect(host.querySelector('[role="dialog"]')).toBeNull();
	});

	it("disables immediately without confirmation", () => {
		const { host, onHardcoreChange } = renderPanel({ hardcore: true });

		click(hardcoreBox(host));

		expect(onHardcoreChange).toHaveBeenCalledOnce();
		expect(onHardcoreChange).toHaveBeenCalledWith(false);
		expect(host.querySelector('[role="dialog"]')).toBeNull();
	});
});
