import type { KeyboardEvent } from "react";
import { useState } from "react";

// P2-T5: Tab cycles the session's permission mode from the composer textarea
// — keyboard parity with the toolbar's permission-mode menu, mirroring the
// Claude Code CLI's Shift+Tab mode toggle. A11Y NOTE: while a session offers
// ≥2 modes, plain Tab/Shift+Tab no longer move focus OUT of the textarea —
// an intentional focus trap, acceptable on this terminal-like surface (Esc
// already carries surface-specific behavior too); every other key, and Tab
// with Ctrl/Meta/Alt, keeps native behavior.

/** The mode `direction` steps away from `current` in `modes`, wrapping at
 * either end — `null` when there's nothing to cycle (fewer than two modes).
 * An unknown/absent `current` starts from the list's edge, so the first Tab
 * lands on the first (or, backwards, last) mode rather than skipping one. */
export function nextPermissionMode(
	current: string | undefined,
	modes: readonly string[],
	direction: 1 | -1
): string | null {
	if (modes.length < 2) {
		return null;
	}
	const index = current === undefined ? -1 : modes.indexOf(current);
	if (index === -1) {
		return (direction === 1 ? modes[0] : modes.at(-1)) ?? null;
	}
	return modes[(index + direction + modes.length) % modes.length];
}

export interface PermissionModeCycleArgs {
	onSetPermissionMode: (mode: string) => void;
	/** The session's reported current mode (`session_ready.permissionMode`). */
	permissionMode?: string;
	/** The modes this agent accepts — cycling is inert below two. */
	permissionModes?: readonly string[];
	/** An open "/" picker owns the keyboard — Tab keeps native behavior then. */
	pickerOpen: boolean;
}

interface OptimisticModeState {
	current: string | undefined;
	setPending: (mode: string) => void;
}

/** The mode to compute "next" from: the last mode WE set this session (not
 * yet confirmed by a fresh `session_ready`) wins over the reported one, so
 * rapid Tab presses keep advancing instead of re-cycling from a stale report.
 * Resets to the report whenever it changes (render-phase adjust, the
 * react.dev "derived state" pattern — same as `useSlashPickerItems`). */
function useOptimisticMode(reported: string | undefined): OptimisticModeState {
	const [pending, setPending] = useState<string | undefined>(undefined);
	const [seenReported, setSeenReported] = useState(reported);
	if (reported !== seenReported) {
		setSeenReported(reported);
		setPending(undefined);
	}
	return { current: pending ?? reported, setPending };
}

/**
 * Keydown layer for Tab-cycling the permission mode. Runs AFTER the slash
 * picker in the composer's keydown chain; returns whether the key was
 * consumed (with preventDefault fired ONLY when a cycle actually happened, so
 * Tab keeps native focus movement for 0/1-mode sessions and open pickers).
 * Shift+Tab cycles backwards; Ctrl/Meta/Alt combos stay native.
 */
export function usePermissionModeCycle(
	args: PermissionModeCycleArgs
): (event: KeyboardEvent<HTMLTextAreaElement>) => boolean {
	const optimistic = useOptimisticMode(args.permissionMode);
	return (event) => {
		const modified = event.ctrlKey || event.metaKey || event.altKey;
		if (event.key !== "Tab" || args.pickerOpen || modified) {
			return false;
		}
		const next = nextPermissionMode(
			optimistic.current,
			args.permissionModes ?? [],
			event.shiftKey ? -1 : 1
		);
		if (next === null) {
			return false;
		}
		event.preventDefault();
		optimistic.setPending(next);
		args.onSetPermissionMode(next);
		return true;
	};
}
