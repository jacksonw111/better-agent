import { useCallback, useEffect, useMemo, useRef } from "react";
import type { StreamEvent } from "./bridge-events";
import { registerShellChannel } from "./shell-channel-store";
import { isShellEvent } from "./shell-events";

// P4-T2: the mounted terminal publishes its shell channel (the feed's
// `runShell` events + the `runShell` control) to the module store the Shell
// pane reads — see shell-channel-store.ts for why this beats a second SSE
// connection. `run` is kept in a ref and exposed as a STABLE callback so the
// channel is only re-published when the shell events (or capability) actually
// change, not on every streamed-token re-render of the terminal.

export function usePublishShellChannel(
	events: StreamEvent[],
	enabled: boolean,
	run: (command: string) => Promise<void>
): void {
	const runRef = useRef(run);
	runRef.current = run;
	const shellEvents = useMemo(() => events.filter(isShellEvent), [events]);
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
