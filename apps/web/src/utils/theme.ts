export type Theme = "light" | "dark";

const THEME_STORAGE_KEY = "theme";
const DARK_CLASS = "dark";

function applyTheme(theme: Theme): void {
	document.documentElement.classList.toggle(DARK_CLASS, theme === "dark");
}

/** Flips the current theme, persists it, and applies it. Returns the new theme. */
export function toggleTheme(): Theme {
	const isDark = document.documentElement.classList.contains(DARK_CLASS);
	const next: Theme = isDark ? "light" : "dark";
	window.localStorage.setItem(THEME_STORAGE_KEY, next);
	applyTheme(next);
	return next;
}
