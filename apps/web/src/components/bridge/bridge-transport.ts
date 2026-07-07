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
	sendInput: (input: { data: unknown; sessionId: string }) => Promise<void>;
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
		sendInput: async (input) => {
			await client.bridge.sendInput(input);
		},
	};
}
