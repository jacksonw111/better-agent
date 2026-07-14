import { afterEach, expect, it } from "vitest";
import {
	getCommandPaletteState,
	registerWorkspaceCommandTarget,
	setCommandPaletteOpen,
	toggleCommandPalette,
	type WorkspaceCommandTarget,
} from "./command-palette-store";

function makeTarget(tokenId: string): WorkspaceCommandTarget {
	return {
		openSettings: () => {
			// spy-free fixture: identity is what the store tests care about
		},
		setTab: () => {
			// see above
		},
		tab: "chat",
		tokenId,
	};
}

const cleanups: (() => void)[] = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) {
		cleanup();
	}
	setCommandPaletteOpen(false);
});

it("toggle and set flip the open flag", () => {
	expect(getCommandPaletteState().open).toBe(false);
	toggleCommandPalette();
	expect(getCommandPaletteState().open).toBe(true);
	setCommandPaletteOpen(false);
	expect(getCommandPaletteState().open).toBe(false);
});

it("register exposes the workspace target and unregister clears it", () => {
	const target = makeTarget("token-1");
	const unregister = registerWorkspaceCommandTarget(target);
	cleanups.push(unregister);
	expect(getCommandPaletteState().workspace).toBe(target);
	unregister();
	expect(getCommandPaletteState().workspace).toBeNull();
});

it("a stale unregister never wipes a newer registration", () => {
	const first = makeTarget("token-1");
	const second = makeTarget("token-2");
	const unregisterFirst = registerWorkspaceCommandTarget(first);
	const unregisterSecond = registerWorkspaceCommandTarget(second);
	cleanups.push(unregisterSecond);
	// The first workspace unmounts AFTER the second registered (route swap).
	unregisterFirst();
	expect(getCommandPaletteState().workspace).toBe(second);
	unregisterSecond();
	expect(getCommandPaletteState().workspace).toBeNull();
});
