import { type Dispatch, useReducer, useState } from "react";
import type { TextWhen } from "./agent-capabilities";
import type { SessionListDetail } from "./bridge-session-list";
import type { BridgeTransport } from "./bridge-transport";
import {
	type ConnectionAction,
	type ConnectionState,
	connectionReducer,
	initialConnectionState,
} from "./terminal-connection";
import {
	useHistorySeed,
	useMaxSeenIdRef,
	usePollFallback,
	useResetOnSessionChange,
} from "./use-bridge-connection-effects";
import {
	type FeedAction,
	type FeedState,
	feedReducer,
	initialFeedState,
} from "./use-bridge-feed";
import {
	makeAnswerApproval,
	makeAnswerQuestion,
	useSessionControls,
} from "./use-bridge-terminal-actions";
import {
	buildResult,
	type UseBridgeTerminalResult,
	useListSessionsWithTimeout,
} from "./use-bridge-terminal-parts";
import { type ImageRef, imageCountSuffix } from "./use-image-attachments";
import { useSseConnection } from "./use-sse-connection";

export type { UseBridgeTerminalResult } from "./use-bridge-terminal-parts";

function useSendInput(
	sessionId: string,
	transport: BridgeTransport,
	dispatchFeed: Dispatch<FeedAction>
) {
	const [sending, setSending] = useState(false);
	const sendRaw = async (data: unknown): Promise<void> => {
		setSending(true);
		try {
			await transport.sendInput({ sessionId, data });
		} finally {
			setSending(false);
		}
	};
	// Plain chat send only: echo the user's own line into the feed immediately
	// (optimistic) BEFORE the round trip. `sendRaw` stays echo-free so approval
	// decisions never produce a fake chat line.
	//
	// R3-T1: `when` rides the send as a busy-turn policy override. Omitted (or
	// "queue", the default) sends the bare trimmed string — byte-identical to
	// the pre-R3-T1 wire shape — since `parseCommandText`
	// (apps/bridge-cli/src/commands.ts) accepts both a bare string and
	// `{text, when}` (no `type` field required for the latter).
	//
	// P3-T2: `images` rides as id refs; the local echo appends the SAME count
	// suffix the CLI appends before forwarding to the agent (see
	// imageCountSuffix's sync note), so echo and persisted message dedupe.
	const sendInput = (
		text: string,
		when?: TextWhen,
		images?: ImageRef[]
	): Promise<void> => {
		const trimmed = text.trim();
		const withImages = images && images.length > 0 ? images : undefined;
		dispatchFeed({
			type: "localEcho",
			text: `${trimmed}${imageCountSuffix(withImages?.length ?? 0)}`,
		});
		if (withImages) {
			const overridden = when && when !== "queue" ? when : undefined;
			return sendRaw({ text: trimmed, when: overridden, images: withImages });
		}
		if (when && when !== "queue") {
			return sendRaw({ text: trimmed, when });
		}
		return sendRaw(trimmed);
	};
	return { sending, sendInput, sendRaw };
}

interface LiveConnectionArgs {
	conn: ConnectionState;
	dispatchConn: Dispatch<ConnectionAction>;
	dispatchFeed: Dispatch<FeedAction>;
	ended: boolean;
	feed: FeedState;
	sessionId: string;
	transport: BridgeTransport;
}

/** Wires up the SSE-first/poll-fallback connection pipeline: history seed
 * gates the live SSE connection, which itself degrades to the poll fallback
 * (see use-bridge-connection-effects.ts for why each ordering matters). Split
 * out purely to keep `useBridgeTerminal` itself under the repo's
 * max-lines-per-function gate. */
function useLiveConnection({
	conn,
	dispatchConn,
	dispatchFeed,
	ended,
	feed,
	sessionId,
	transport,
}: LiveConnectionArgs): void {
	const historyLoaded = useHistorySeed({ sessionId, transport, dispatchFeed });
	const maxSeenIdRef = useMaxSeenIdRef(feed.maxSeenId);
	const enabled = !ended && historyLoaded;
	useSseConnection({
		sessionId,
		enabled,
		maxSeenIdRef,
		transport,
		dispatchFeed,
		dispatchConn,
	});
	usePollFallback({
		sessionId,
		status: conn.status,
		enabled,
		maxSeenIdRef,
		transport,
		dispatchFeed,
		dispatchConn,
	});
}

/**
 * Drives a bridge session's terminal feed: SSE-first with poll-fallback
 * degrade (see use-bridge-connection-effects.ts), deduped/ordered by id (see
 * event-feed.ts), plus the sendInput mutation. `transport` is injected so
 * this hook — and anything built on it — can be tested against a fake
 * instead of real network/oRPC calls.
 *
 * `ended` marks a session the server has already closed out (`endSession`
 * was called, or it was already ended when the page loaded): both the SSE
 * and poll-fallback effects are disabled outright — there's no local CLI
 * left to reconnect to, so retrying would just spin forever — and the
 * reported `status` becomes `"ended"` regardless of whatever transient
 * connection state came before, with sending disabled to match.
 */
/** Sets up the feed/connection reducers and the SSE-first/poll-fallback
 * pipeline (reset on session change, then the live connection) — split out
 * purely to keep `useBridgeTerminal` under the repo's max-lines-per-function
 * gate. */
function useFeedPipeline(
	sessionId: string,
	transport: BridgeTransport,
	ended: boolean
): {
	conn: ConnectionState;
	dispatchFeed: Dispatch<FeedAction>;
	feed: FeedState;
} {
	const [feed, dispatchFeed] = useReducer(feedReducer, initialFeedState);
	const [conn, dispatchConn] = useReducer(
		connectionReducer,
		initialConnectionState
	);
	useResetOnSessionChange(sessionId, dispatchFeed, dispatchConn);
	useLiveConnection({
		conn,
		dispatchConn,
		dispatchFeed,
		ended,
		feed,
		sessionId,
		transport,
	});
	return { conn, dispatchFeed, feed };
}

/** Wires the session's control commands (getStatus/interrupt/setModel/
 * setPermissionMode/setThinking/listSessions/restart) plus the listSessions
 * timeout fallback — split out purely to keep `useBridgeTerminal` under the
 * repo's max-lines-per-function gate. */
function useControls(
	sendRaw: (data: unknown) => Promise<void>,
	feedSessionList: SessionListDetail | null,
	sessionId: string
) {
	const {
		getStatus,
		interrupt,
		restart,
		setModel,
		setPermissionMode,
		setThinking,
		listSessions: requestSessions,
	} = useSessionControls(sendRaw, sessionId);
	const { listSessions, sessionList } = useListSessionsWithTimeout(
		requestSessions,
		feedSessionList
	);
	return {
		getStatus,
		interrupt,
		listSessions,
		restart,
		sessionList,
		setModel,
		setPermissionMode,
		setThinking,
	};
}

/** Curated status details are now folded incrementally into the feed reducer
 * (see use-bridge-feed.ts) rather than rescanned off `feed.events` on every
 * render — the same latest-wins semantics, without the four full tail scans
 * per event that made a streaming session O(n²). Bundled together with the
 * session's control commands (see `useControls`) purely to keep
 * `useBridgeTerminal` itself under the repo's max-lines-per-function gate. */
function useCuratedAndControls(
	feed: FeedState,
	sendRaw: (data: unknown) => Promise<void>,
	sessionId: string
): Pick<
	FeedState,
	| "commandCatalog"
	| "queueUpdate"
	| "sessionReady"
	| "statusSnapshot"
	| "turnUsage"
	| "usageUpdate"
> &
	ReturnType<typeof useControls> {
	const {
		commandCatalog,
		queueUpdate,
		sessionReady,
		statusSnapshot,
		turnUsage,
		usageUpdate,
	} = feed;
	return {
		commandCatalog,
		queueUpdate,
		sessionReady,
		statusSnapshot,
		turnUsage,
		usageUpdate,
		...useControls(sendRaw, feed.sessionList, sessionId),
	};
}

export function useBridgeTerminal(
	sessionId: string,
	transport: BridgeTransport,
	ended: boolean
): UseBridgeTerminalResult {
	const { conn, dispatchFeed, feed } = useFeedPipeline(
		sessionId,
		transport,
		ended
	);
	const { sending, sendInput, sendRaw } = useSendInput(
		sessionId,
		transport,
		dispatchFeed
	);
	const curated = useCuratedAndControls(feed, sendRaw, sessionId);

	return buildResult({
		answerApproval: makeAnswerApproval(dispatchFeed, sendRaw),
		answerQuestion: makeAnswerQuestion(dispatchFeed, sendRaw),
		conn,
		ended,
		feed,
		sendInput,
		sending,
		...curated,
	});
}
