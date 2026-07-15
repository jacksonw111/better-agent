import {
	type Dispatch,
	type SetStateAction,
	useCallback,
	useEffect,
	useState,
} from "react";
import type { FsChannel } from "./fs-channel-store";
import type { FsEntry } from "./fs-events";

// P4-T3: the Files tab's tree state — lazily-loaded directory listings keyed
// by workspace-relative path ("" = the root), plus the expanded set. Loading
// happens on demand: the root when the pane first becomes visible, every
// other directory on its first expand (an errored dir reloads on re-expand).

export type DirState =
	| { status: "error" }
	| { status: "loading" }
	| { entries: FsEntry[]; status: "ready"; truncated: boolean };

export interface FileTreeState {
	dirs: Record<string, DirState>;
	expanded: ReadonlySet<string>;
	toggleDir: (path: string) => void;
}

function needsLoad(state: DirState | undefined): boolean {
	return state === undefined || state.status === "error";
}

/** The one loader every dir goes through: marks `path` loading, lists it over
 * the channel, settles ready/error. Split out of `useFileTree` purely for the
 * max-lines-per-function gate. */
function useDirLoader(
	channel: FsChannel | null,
	setDirs: Dispatch<SetStateAction<Record<string, DirState>>>
): (path: string) => void {
	return useCallback(
		(path: string) => {
			if (!channel) {
				return;
			}
			setDirs((prev) => ({ ...prev, [path]: { status: "loading" } }));
			channel.list(path === "" ? undefined : path).then(
				(result) =>
					setDirs((prev) => ({
						...prev,
						[path]: {
							entries: result.entries,
							status: "ready",
							truncated: result.truncated,
						},
					})),
				() => setDirs((prev) => ({ ...prev, [path]: { status: "error" } }))
			);
		},
		[channel, setDirs]
	);
}

export function useFileTree(
	channel: FsChannel | null,
	active: boolean
): FileTreeState {
	const [dirs, setDirs] = useState<Record<string, DirState>>({});
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set([""]));
	const enabled = channel?.enabled === true;
	const load = useDirLoader(channel, setDirs);

	// A channel swap (session switch republishes) means a possibly different
	// workspace — drop every cached listing.
	// biome-ignore lint/correctness/useExhaustiveDependencies: channel is deliberately the reset trigger, not read inside
	useEffect(() => {
		setDirs({});
		setExpanded(new Set([""]));
	}, [channel]);

	const rootLoaded = dirs[""] !== undefined;
	useEffect(() => {
		if (active && enabled && !rootLoaded) {
			load("");
		}
	}, [active, enabled, rootLoaded, load]);

	const toggleDir = (path: string) => {
		const opening = !expanded.has(path);
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(path)) {
				next.delete(path);
			} else {
				next.add(path);
			}
			return next;
		});
		if (opening && needsLoad(dirs[path])) {
			load(path);
		}
	};

	return { dirs, expanded, toggleDir };
}
