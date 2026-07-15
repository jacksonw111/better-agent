import { useEffect, useRef, useState } from "react";
import type { TextWhen } from "./agent-capabilities";
import type { CommandCatalogDetail } from "./bridge-command-catalog";
import type { QueueUpdateDetail } from "./bridge-queue-status";
import type { SessionListDetail } from "./bridge-session-list";
import type {
	SessionReadyDetail,
	TurnUsageDetail,
	UsageUpdateDetail,
} from "./bridge-session-status";
import type { StatusSnapshotDetail } from "./bridge-status-snapshot";
import type { ConnectionState } from "./terminal-connection";
import type { TerminalConnectionStatus } from "./terminal-status";
import type { FeedState } from "./use-bridge-feed";
import type { ImageRef } from "./use-image-attachments";

// Pieces of `useBridgeTerminal` pulled out purely to keep that file (and its
// main hook) under the repo's max-lines gates: the "Past conversations" timeout
// fallback, the public result type, and the final result assembly.

export interface UseBridgeTerminalResult {
	answerApproval: (requestId: string, optionId: string) => Promise<void>;
	answered: Record<string, string>;
	answeredQuestions: Record<string, string[][]>;
	/** R3-T3: mirrors `answerApproval`/`answered` for a `question` turn. */
	answerQuestion: (requestId: string, answers: string[][]) => Promise<void>;
	canSend: boolean;
	/** The latest `command_catalog` detail (R5-T2), or `null` before any
	 * adapter has emitted one — see `FeedState.commandCatalog`. */
	commandCatalog: CommandCatalogDetail | null;
	events: FeedState["events"];
	/** Requests a fresh `status_snapshot` — the detail page's status refresh
	 * affordance. Routed as `{ type: "control", action: "getStatus" }`; the
	 * reply arrives asynchronously as a `status_snapshot` status event,
	 * reflected in `statusSnapshot` once it lands. */
	getStatus: () => Promise<void>;
	/** Cancels the in-flight turn without ending the session — the detail
	 * page's Stop/Interrupt button. Routed as `{ type: "control", action:
	 * "interrupt" }`; see `apps/bridge-cli/src/commands.ts`. */
	interrupt: () => Promise<void>;
	/** Requests the agent's past local conversations — the "Past
	 * conversations" button. Routed as `{ type: "control", action:
	 * "listSessions" }`; the reply arrives asynchronously as a `session_list`
	 * status event, reflected in `sessionList` once it lands. */
	listSessions: () => Promise<void>;
	/** The latest `queue_update` detail (R3-T1), or `null` before pi has
	 * reported anything queued behind the in-flight turn. */
	queueUpdate: QueueUpdateDetail | null;
	/** Asks the CLI to tear down and relaunch under the same sessionId (R3) —
	 * the detail page's Restart button. A distinct `bridge.restartSession`
	 * server procedure, not a `sendRaw` control command (see
	 * use-bridge-terminal-actions.ts). */
	restart: () => Promise<void>;
	/** R3-T1: `when` rides the send as a busy-turn policy override ("steer"/
	 * "interrupt") — omitted (or "queue", the default) sends the plain queued
	 * text, identical to the pre-R3-T1 single-argument call. See
	 * `parseCommandText` (apps/bridge-cli/src/commands.ts) for the wire shape
	 * this produces. */
	sendInput: (
		text: string,
		when?: TextWhen,
		images?: ImageRef[]
	) => Promise<void>;
	sending: boolean;
	/** The latest `session_list` detail, or `null` before a `listSessions`
	 * request has gotten a reply. */
	sessionList: SessionListDetail | null;
	/** The latest `session_ready` detail (model/cwd/capabilities/mcp), or
	 * `null` before the CLI's session has initialized — see
	 * bridge-session-status.ts. */
	sessionReady: SessionReadyDetail | null;
	/** Switches the model used for subsequent turns — the detail page's model
	 * picker. Routed as `{ type: "control", action: "setModel", model }`. */
	setModel: (model: string) => Promise<void>;
	/** Switches the session's permission mode — the detail page's mode
	 * dropdown. Routed as `{ type: "control", action: "setPermissionMode",
	 * mode }`. */
	setPermissionMode: (mode: string) => Promise<void>;
	/** Switches the reasoning-effort level for subsequent turns — the
	 * composer's Thinking picker. Routed as `{ type: "control", action:
	 * "setThinking", level }`. */
	setThinking: (level: string) => Promise<void>;
	status: TerminalConnectionStatus;
	/** The latest `status_snapshot` detail (model/context/cost/tokens/mcp/
	 * running), or `null` before a `getStatus` request has gotten a reply. */
	statusSnapshot: StatusSnapshotDetail | null;
	/** The latest `turn_usage` detail (cost/tokens/turns), or `null` before
	 * any turn has completed. */
	turnUsage: TurnUsageDetail | null;
	/** The latest `usage_update` detail (opencode's streamed context/cost), or
	 * `null` before one has arrived. */
	usageUpdate: UsageUpdateDetail | null;
}

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
	/** R3-T3: mirrors `answerApproval` for a `question` turn. */
	answerQuestion: (requestId: string, answers: string[][]) => Promise<void>;
	commandCatalog: CommandCatalogDetail | null;
	conn: ConnectionState;
	ended: boolean;
	feed: FeedState;
	/** Requests a fresh `status_snapshot` — the detail page's status refresh
	 * affordance. Fire-and-forget, same shape as `listSessions`. */
	getStatus: () => Promise<void>;
	interrupt: () => Promise<void>;
	listSessions: () => Promise<void>;
	/** The latest `queue_update` detail (R3-T1), or `null` before pi has
	 * reported anything queued behind the in-flight turn. */
	queueUpdate: QueueUpdateDetail | null;
	/** Asks the CLI to tear down and relaunch under the same sessionId (R3). */
	restart: () => Promise<void>;
	sendInput: (
		text: string,
		when?: TextWhen,
		images?: ImageRef[]
	) => Promise<void>;
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
		commandCatalog: args.commandCatalog,
		events: args.feed.events,
		status: args.ended ? "ended" : args.conn.status,
		canSend: !args.ended,
		sending: args.sending,
		sendInput: args.sendInput,
		answered: args.feed.answered,
		answerApproval: args.answerApproval,
		answeredQuestions: args.feed.answeredQuestions,
		answerQuestion: args.answerQuestion,
		interrupt: args.interrupt,
		setModel: args.setModel,
		setPermissionMode: args.setPermissionMode,
		setThinking: args.setThinking,
		listSessions: args.listSessions,
		queueUpdate: args.queueUpdate,
		restart: args.restart,
		sessionReady: args.sessionReady,
		sessionList: args.sessionList,
		getStatus: args.getStatus,
		statusSnapshot: args.statusSnapshot,
		turnUsage: args.turnUsage,
		usageUpdate: args.usageUpdate,
	};
}
