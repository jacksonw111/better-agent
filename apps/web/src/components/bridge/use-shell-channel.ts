import { useCallback, useEffect, useRef, useState } from "react";
import type { StreamEvent } from "./bridge-events";
import { registerShellChannel } from "./shell-channel-store";
import { isShellEvent } from "./shell-events";

// P4-T2: the mounted terminal publishes its shell channel (the feed's
// `runShell` events + the `runShell` control) to the module store the Shell
// pane reads — see shell-channel-store.ts for why this beats a second SSE
// connection. `run` is kept in a ref and exposed as a STABLE callback so the
// channel is only re-published when the shell events (or capability) actually
// change, not on every streamed-token re-render of the terminal.
//
// Shell events are accumulated INCREMENTALLY — only the feed's new tail is
// scanned per render (cursor pattern, same as use-fs-channel.ts), never the
// whole unbounded array. A full `events.filter` per streamed token was one of
// the O(n)-per-render costs behind the /tasks chat tab's crash. A shrink
// (session switch resets the feed) rewinds the cursor and rebuilds.

export function usePublishShellChannel(
	events: StreamEvent[],
	enabled: boolean,
	run: (command: string) => Promise<void>
): void {
	const runRef = useRef(run);
	runRef.current = run;
	const [shellEvents, setShellEvents] = useState<StreamEvent[]>([]);
	const cursorRef = useRef(0);
	useEffect(() => {
		const start = events.length < cursorRef.current ? 0 : cursorRef.current;
		cursorRef.current = events.length;
		const fresh = events.slice(start).filter(isShellEvent);
		if (start === 0) {
			// Rebuild (initial mount or feed reset) — but keep the empty-array
			// reference stable so a reset feed doesn't republish the channel.
			setShellEvents((previous) =>
				previous.length === 0 && fresh.length === 0 ? previous : fresh
			);
			return;
		}
		if (fresh.length > 0) {
			setShellEvents((previous) => [...previous, ...fresh]);
		}
	}, [events]);
	const stableRun = useCallback(
		(command: string) => runRef.current(command),
		[]
	);
	useEffect(
		() =>
			registerShellChannel({
				enabled,
				events: shellEvents,
				run: stableRun,
			}),
		[shellEvents, enabled, stableRun]
	);
}
