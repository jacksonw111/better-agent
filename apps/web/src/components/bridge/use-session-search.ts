import { useEffect, useRef } from "react";
import type { StreamEvent } from "./bridge-events";
import {
	createSessionSearchCorrelator,
	type SessionSearchCorrelator,
	type SessionSearchSender,
} from "./session-search-correlation";
import { registerSessionSearchChannel } from "./session-search-store";

// P4-T5: the mounted terminal publishes its search channel (requestId-
// correlated `searchSessions` over the session's control channel + feed) to
// the module store the ⌘K palette reads — see session-search-store.ts.
// Mirrors use-git-channel.ts: `send` is kept in a ref so the correlator
// (created once per mount) always calls the latest control callback without
// being rebuilt per render.

export function usePublishSessionSearchChannel(
	events: StreamEvent[],
	enabled: boolean,
	send: SessionSearchSender["search"]
): void {
	const sendRef = useRef(send);
	sendRef.current = send;
	const correlatorRef = useRef<SessionSearchCorrelator | null>(null);
	correlatorRef.current ??= createSessionSearchCorrelator({
		send: {
			search: (requestId, query) => sendRef.current(requestId, query),
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
			registerSessionSearchChannel({
				enabled,
				search: (query) => correlator.search(query),
			}),
		[enabled, correlator]
	);

	// Reject anything still pending when the publishing terminal unmounts.
	useEffect(() => () => correlator.dispose(), [correlator]);
}
