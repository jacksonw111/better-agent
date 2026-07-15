import { useEffect, useRef } from "react";
import type { StreamEvent } from "./bridge-events";
import { registerGitChannel } from "./git-channel-store";
import {
	createGitCorrelator,
	type GitCorrelator,
	type GitSender,
} from "./git-correlation";

// P4-T4: the mounted terminal publishes its git channel (requestId-correlated
// gitStatus/gitDiff/gitCommit over the session's control channel + feed) to
// the module store the Git pane reads — see git-channel-store.ts. Mirrors
// use-fs-channel.ts: `send` is kept in a ref so the correlator (created once
// per mount) always calls the latest control callbacks without being rebuilt
// per render.

export function usePublishGitChannel(
	events: StreamEvent[],
	enabled: boolean,
	send: GitSender
): void {
	const sendRef = useRef(send);
	sendRef.current = send;
	const correlatorRef = useRef<GitCorrelator | null>(null);
	correlatorRef.current ??= createGitCorrelator({
		send: {
			commit: (requestId, message) =>
				sendRef.current.commit(requestId, message),
			diff: (requestId, path) => sendRef.current.diff(requestId, path),
			status: (requestId) => sendRef.current.status(requestId),
		},
	});
	const correlator = correlatorRef.current;

	// Feed only the NEW tail of the events array into the correlator; a shrink
	// (session switch resets the feed) rewinds the cursor.
	const cursorRef = useRef(0);
	useEffect(() => {
		if (events.length < cursorRef.current) {
			cursorRef.current = 0;
		}
		correlator.ingest(events.slice(cursorRef.current));
		cursorRef.current = events.length;
	}, [events, correlator]);

	useEffect(
		() =>
			registerGitChannel({
				commit: (message) => correlator.commit(message),
				diff: (path) => correlator.diff(path),
				enabled,
				status: () => correlator.status(),
			}),
		[enabled, correlator]
	);

	// Reject anything still pending when the publishing terminal unmounts.
	useEffect(() => () => correlator.dispose(), [correlator]);
}
