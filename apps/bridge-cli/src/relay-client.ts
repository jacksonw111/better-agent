// The relay transport contract, plus a re-export hub for the two loops that
// implement it: forwardEvents (forward-events.ts, push half) and
// runBridgeSession (run-bridge-session.ts, orchestration half — including
// RC-T5's activity watchdog). Split across three files purely to keep each
// under the repo's max-lines-per-file gate; every existing import path
// (`from "./relay-client"`) keeps working via these re-exports.

import type { AgentStartConfig } from "./adapters/types";
import type { RelayEvent } from "./commands";

export type { AgentSessionIdRef } from "./capture-agent-session-id";
export {
	type ForwardEventsOptions,
	forwardEvents,
	type QueuedEvent,
	type Sleep,
} from "./forward-events";
export { type PollOutcome, pollLoop } from "./poll-loop";
export {
	type RunBridgeSessionOptions,
	runBridgeSession,
} from "./run-bridge-session";

/** The subset of the `bridge:` oRPC router this CLI calls. */
export interface RelayTransport {
	/** Re-fetches the calling bridge token's current persisted startup config
	 * (the same shape `startSession`'s `config` returns) — what a restarting
	 * CLI calls instead of `startSession` again, since minting a new session
	 * would break the seamless reconnect a restart is for (see
	 * `restart-loop.ts`). */
	fetchConfig(): Promise<{ config: AgentStartConfig | null }>;
	pollCommands(input: {
		afterId: number;
		sessionId: string;
	}): Promise<RelayEvent[]>;
	pushEvents(input: {
		sessionId: string;
		events: unknown[];
		/** T1 (docs/remote-control-redesign-plan.md): client-minted, index-aligned
		 * with `events` — see `QueuedEvent`. Stable across a push-queue retry of
		 * the same batch, so the relay can dedup a resend whose ack was lost. */
		idempotencyKeys?: string[];
	}): Promise<void>;
	startSession(input: {
		agentKind: string;
		label?: string;
	}): Promise<{ config: AgentStartConfig | null; sessionId: string }>;
}
