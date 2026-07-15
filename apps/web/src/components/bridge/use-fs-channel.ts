import { useEffect, useRef } from "react";
import type { StreamEvent } from "./bridge-events";
import { registerFsChannel } from "./fs-channel-store";
import {
	createFsCorrelator,
	type FsCorrelator,
	type FsSender,
} from "./fs-correlation";

// P4-T3: the mounted terminal publishes its fs channel (requestId-correlated
// `fsList`/`fsRead` over the session's control channel + feed) to the module
// store the Files pane and @file picker read — see fs-channel-store.ts.
// `send` is kept in a ref so the correlator (created once per mount) always
// calls the latest control callbacks without being rebuilt per render.

export function usePublishFsChannel(
	events: StreamEvent[],
	enabled: boolean,
	send: FsSender
): void {
	const sendRef = useRef(send);
	sendRef.current = send;
	const correlatorRef = useRef<FsCorrelator | null>(null);
	correlatorRef.current ??= createFsCorrelator({
		send: {
			list: (requestId, path) => sendRef.current.list(requestId, path),
			read: (requestId, path) => sendRef.current.read(requestId, path),
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
			registerFsChannel({
				enabled,
				list: (path) => correlator.list(path),
				read: (path) => correlator.read(path),
			}),
		[enabled, correlator]
	);

	// Reject anything still pending when the publishing terminal unmounts.
	useEffect(() => () => correlator.dispose(), [correlator]);
}
