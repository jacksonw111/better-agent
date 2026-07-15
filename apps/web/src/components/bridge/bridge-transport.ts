// The terminal's view of the network: SSE connect, poll-fallback observe, and
// sendInput. Isolated behind this interface so `useBridgeTerminal` (and the
// components that use it) can be exercised in tests against a fake transport
// instead of a real fetch/oRPC round trip — mirrors how `Conversation` takes
// an injected `AgentClient` (see packages/ui/src/components/chat).

import { client } from "@/utils/orpc";
import type { RawBridgeEvent } from "./bridge-events";
import { connectBridgeStream } from "./sse-client";

export interface ConnectStreamArgs {
	afterId: number;
	onError: () => void;
	onEvent: (raw: RawBridgeEvent) => void;
	onOpen: () => void;
	sessionId: string;
}

/** One persisted row from `orpc.bridge.history` — `seq` is the same relay id
 * the live SSE/observe feed uses, so it can be fed through the identical
 * `mergeEvents` dedupe path as a live frame (see use-bridge-connection-effects.ts). */
interface BridgeHistoryEvent {
	event: unknown;
	seq: number;
}

/** P5-1: one already-answered request from `orpc.bridge.pendingRequests` —
 * the web folds it into the feed's answered maps so a replayed card renders
 * as handled instead of actionable (covers answers sent from OTHER devices,
 * which never appear in this client's own dispatch history). */
export type AnsweredBridgeRequest =
	| { kind: "approval"; optionId: string; requestId: string }
	| { answers: string[][]; kind: "question"; requestId: string };

/** P5-1: `orpc.bridge.pendingRequests`'s shape — still-open approval/question
 * events (verbatim, with their persisted seqs) plus the requests already
 * answered from any device. */
export interface PendingBridgeRequests {
	answered: AnsweredBridgeRequest[];
	pending: { event: unknown; requestId: string; seq: number }[];
}

export interface BridgeTransport {
	connectStream: (args: ConnectStreamArgs) => () => void;
	history: (input: {
		afterSeq?: number;
		limit?: number;
		sessionId: string;
	}) => Promise<BridgeHistoryEvent[]>;
	observe: (input: {
		afterId: number;
		sessionId: string;
	}) => Promise<RawBridgeEvent[]>;
	/** P5-1: still-unanswered approval/question replay, fetched right after the
	 * history seed (see useHistorySeed). Optional so existing fake transports
	 * in tests keep compiling — without it, the seed simply skips the replay
	 * step (the pre-P5-1 behavior). */
	pendingRequests?: (input: {
		sessionId: string;
	}) => Promise<PendingBridgeRequests>;
	sendInput: (input: { data: unknown; sessionId: string }) => Promise<void>;
	/** P3-T2: uploads one composer image against the bridge session; the
	 * returned ref rides the text command as `images[]`. Optional so existing
	 * fake transports in tests keep compiling — the attach UI only mounts when
	 * both this and the `images` capability are present. */
	uploadAttachment?: (input: {
		file: File;
		sessionId: string;
	}) => Promise<{ id: string; mime: string; name: string }>;
}

export function createBridgeTransport(): BridgeTransport {
	return {
		connectStream: ({ sessionId, afterId, onEvent, onOpen, onError }) =>
			connectBridgeStream(sessionId, afterId, {
				onEvent,
				onOpen,
				onError,
			}),
		history: (input) => client.bridge.history(input),
		observe: (input) => client.bridge.observe(input),
		pendingRequests: (input) => client.bridge.pendingRequests(input),
		sendInput: async (input) => {
			await client.bridge.sendInput(input);
		},
		uploadAttachment: (input) => client.bridge.uploadBridgeAttachment(input),
	};
}
