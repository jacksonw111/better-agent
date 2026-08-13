import { afterEach, expect, it } from "vitest";
import {
	getCommandPaletteState,
	setCommandPaletteOpen,
	toggleCommandPalette,
} from "./command-palette-store";

afterEach(() => {
	setCommandPaletteOpen(false);
});

it("toggle and set flip the open flag", () => {
	expect(getCommandPaletteState().open).toBe(false);
	toggleCommandPalette();
	expect(getCommandPaletteState().open).toBe(true);
	setCommandPaletteOpen(false);
	expect(getCommandPaletteState().open).toBe(false);
});
