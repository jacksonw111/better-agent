import { useCallback, useEffect, useRef, useState } from "react";
import type { GitChannel } from "./git-channel-store";
import type { GitStatusResult } from "./git-events";

// P4-T4: the Git pane's state — the status summary (loaded when the pane
// first becomes visible, re-loaded on refresh/commit) and the diff selection
// (per-file, or the whole tree). Both reset when the channel swaps (session
// switch republishes → possibly a different workspace). Stale-response-safe:
// only the LATEST request may settle its state, mirroring the files pane's
// preview guard.

export type GitStatusState =
	| { kind: "error"; message: string }
	| { kind: "idle" }
	| { kind: "loading" }
	| { kind: "notARepo" }
	| { kind: "ready"; summary: GitStatusResult };

export type GitDiffState =
	| { kind: "error"; message: string; path: string | null }
	| { kind: "idle" }
	| { kind: "loading"; path: string | null }
	| { kind: "ready"; path: string | null; text: string; truncated: boolean };

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : "请重试";
}

/** Status summary + refresh. `active` is "the pane is visible AND the channel
 * is enabled" — the first activation triggers the initial load. */
export function useGitStatus(
	channel: GitChannel | null,
	active: boolean
): { refresh: () => void; state: GitStatusState } {
	const [state, setState] = useState<GitStatusState>({ kind: "idle" });
	const seqRef = useRef(0);

	const refresh = useCallback(() => {
		if (!channel?.enabled) {
			return;
		}
		seqRef.current += 1;
		const seq = seqRef.current;
		const settle = (next: GitStatusState) => {
			if (seqRef.current === seq) {
				setState(next);
			}
		};
		setState({ kind: "loading" });
		channel.status().then(
			(summary) =>
				settle(
					summary.notARepo ? { kind: "notARepo" } : { kind: "ready", summary }
				),
			(error: unknown) => settle({ kind: "error", message: errorText(error) })
		);
	}, [channel]);

	// Channel swap → drop the previous workspace's summary (and invalidate any
	// in-flight request via the bumped seq).
	// biome-ignore lint/correctness/useExhaustiveDependencies: channel is deliberately the reset trigger, not read inside
	useEffect(() => {
		seqRef.current += 1;
		setState({ kind: "idle" });
	}, [channel]);

	const idle = state.kind === "idle";
	useEffect(() => {
		if (active && idle) {
			refresh();
		}
	}, [active, idle, refresh]);

	return { refresh, state };
}

/** Diff selection: `open(path)` for one file, `open(null)` for the whole
 * tree, `clear()` back to the list (on <md). */
export function useGitDiff(channel: GitChannel | null): {
	clear: () => void;
	open: (path: string | null) => void;
	view: GitDiffState;
} {
	const [view, setView] = useState<GitDiffState>({ kind: "idle" });
	const seqRef = useRef(0);

	// biome-ignore lint/correctness/useExhaustiveDependencies: channel is deliberately the reset trigger, not read inside
	useEffect(() => {
		seqRef.current += 1;
		setView({ kind: "idle" });
	}, [channel]);

	const open = (path: string | null) => {
		seqRef.current += 1;
		const seq = seqRef.current;
		const settle = (next: GitDiffState) => {
			if (seqRef.current === seq) {
				setView(next);
			}
		};
		setView({ kind: "loading", path });
		channel?.diff(path ?? undefined).then(
			(result) =>
				settle({
					kind: "ready",
					path,
					text: result.content,
					truncated: result.truncated,
				}),
			(error: unknown) =>
				settle({ kind: "error", message: errorText(error), path })
		);
	};

	const clear = () => {
		seqRef.current += 1;
		setView({ kind: "idle" });
	};

	return { clear, open, view };
}
