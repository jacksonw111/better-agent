import { useEffect, useRef, useState } from "react";
import type { SessionListDetail } from "./bridge-session-list";
import type {
	SessionReadyDetail,
	TurnUsageDetail,
	UsageUpdateDetail,
} from "./bridge-session-status";
import type { StatusSnapshotDetail } from "./bridge-status-snapshot";
import type { ConnectionState } from "./terminal-connection";
import type { FeedState } from "./use-bridge-feed";
import type { UseBridgeTerminalResult } from "./use-bridge-terminal";

// Pieces of `useBridgeTerminal` pulled out purely to keep that file (and its
// main hook) under the repo's max-lines gates: the "Past conversations" timeout
// fallback and the final result assembly.

/** How long the "Past conversations" popover waits for a `session_list` reply
 * before giving up and showing an empty state. Only the claude adapter answers
 * the `listSessions` control today (see agent-capabilities.ts); this is a
 * safety net so a slow/absent responder shows "no past conversations" instead
 * of spinning on "Loading…" forever. */
const SESSION_LIST_TIMEOUT_MS = 6000;

const EMPTY_SESSION_LIST: SessionListDetail = { sessions: [] };

/** Wraps the raw `listSessions` control request with a timeout fallback:
 * `sessionList` reflects the feed's real reply as soon as it arrives, but if
 * none does within SESSION_LIST_TIMEOUT_MS the popover surfaces an empty list
 * rather than an endless "Loading…". A reply landing later still wins (it
 * clears the timeout and replaces the fallback). */
export function useListSessionsWithTimeout(
	request: () => Promise<void>,
	feedSessionList: SessionListDetail | null
): {
	listSessions: () => Promise<void>;
	sessionList: SessionListDetail | null;
} {
	const [timedOut, setTimedOut] = useState(false);
	const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	useEffect(() => {
		if (feedSessionList !== null && timerRef.current !== undefined) {
			clearTimeout(timerRef.current);
			timerRef.current = undefined;
			setTimedOut(false);
		}
	}, [feedSessionList]);
	useEffect(
		() => () => {
			if (timerRef.current !== undefined) {
				clearTimeout(timerRef.current);
			}
		},
		[]
	);
	const listSessions = async (): Promise<void> => {
		setTimedOut(false);
		if (timerRef.current !== undefined) {
			clearTimeout(timerRef.current);
		}
		timerRef.current = setTimeout(
			() => setTimedOut(true),
			SESSION_LIST_TIMEOUT_MS
		);
		await request();
	};
	const sessionList = feedSessionList ?? (timedOut ? EMPTY_SESSION_LIST : null);
	return { listSessions, sessionList };
}

export interface BuildResultArgs {
	answerApproval: (requestId: string, optionId: string) => Promise<void>;
	conn: ConnectionState;
	ended: boolean;
	feed: FeedState;
	/** Requests a fresh `status_snapshot` — the detail page's status refresh
	 * affordance. Fire-and-forget, same shape as `listSessions`. */
	getStatus: () => Promise<void>;
	interrupt: () => Promise<void>;
	listSessions: () => Promise<void>;
	/** Asks the CLI to tear down and relaunch under the same sessionId (R3). */
	restart: () => Promise<void>;
	sendInput: (text: string) => Promise<void>;
	sending: boolean;
	sessionList: SessionListDetail | null;
	sessionReady: SessionReadyDetail | null;
	setModel: (model: string) => Promise<void>;
	setPermissionMode: (mode: string) => Promise<void>;
	setThinking: (level: string) => Promise<void>;
	statusSnapshot: StatusSnapshotDetail | null;
	turnUsage: TurnUsageDetail | null;
	usageUpdate: UsageUpdateDetail | null;
}

/** Assembles the public hook result from the wired-up pieces — split out purely
 * to keep `useBridgeTerminal` under the repo's max-lines-per-function gate.
 * `canSend` is gated only on `ended`, NOT on the output stream having connected:
 * input (sendInput RPC → commands) and output (the SSE observe stream) are
 * INDEPENDENT channels, and gating send on the output stream once silenced input
 * entirely when the SSE couldn't connect — the user could neither send nor see
 * anything. Send whenever the session is live. */
export function buildResult(args: BuildResultArgs): UseBridgeTerminalResult {
	return {
		events: args.feed.events,
		status: args.ended ? "ended" : args.conn.status,
		canSend: !args.ended,
		sending: args.sending,
		sendInput: args.sendInput,
		answered: args.feed.answered,
		answerApproval: args.answerApproval,
		interrupt: args.interrupt,
		setModel: args.setModel,
		setPermissionMode: args.setPermissionMode,
		setThinking: args.setThinking,
		listSessions: args.listSessions,
		restart: args.restart,
		sessionReady: args.sessionReady,
		sessionList: args.sessionList,
		getStatus: args.getStatus,
		statusSnapshot: args.statusSnapshot,
		turnUsage: args.turnUsage,
		usageUpdate: args.usageUpdate,
	};
}
