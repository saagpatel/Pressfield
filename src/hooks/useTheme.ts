import { useLayoutEffect, useState } from "react";

export type Theme = "dark" | "light";

const STORAGE_KEY = "pressfield-theme";

// Pure: the opposite theme.
export function nextTheme(theme: Theme): Theme {
	return theme === "dark" ? "light" : "dark";
}

// Pure: narrow a stored value to a Theme, defaulting to dark.
export function parseTheme(value: string | null): Theme {
	return value === "light" || value === "dark" ? value : "dark";
}

function readStored(): Theme {
	try {
		return parseTheme(localStorage.getItem(STORAGE_KEY));
	} catch {
		return "dark"; // storage unavailable (e.g. private mode)
	}
}

// Dark/light theme with localStorage persistence. Applies `data-theme` to the
// document element (the CSS token overrides hang off it) before paint, so the
// theme never flashes; DecayCanvas watches that attribute to re-tint its overlay.
export function useTheme(): { theme: Theme; toggle: () => void } {
	const [theme, setTheme] = useState<Theme>(readStored);

	useLayoutEffect(() => {
		document.documentElement.dataset.theme = theme;
		try {
			localStorage.setItem(STORAGE_KEY, theme);
		} catch {
			// best-effort persistence; a failed write just means no carry-over
		}
	}, [theme]);

	return { theme, toggle: () => setTheme(nextTheme) };
}
