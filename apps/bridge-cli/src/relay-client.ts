// The relay transport contract, plus a re-export hub for the two loops that
// implement it: forwardEvents (forward-events.ts, push half) and
// runBridgeSession (run-bridge-session.ts, orchestration half — including
// RC-T5's activity watchdog). Split across three files purely to keep each
// under the repo's max-lines-per-file gate; every existing import path
// (`from "./relay-client"`) keeps working via these re-exports.

import type {
	AgentStartConfig,
	ResolvedMcpServer,
	ResolvedSkill,
} from "./adapters/types";
import type { RelayEvent } from "./commands";
import type { DuplexChannel } from "./ws-duplex";

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
export type { DuplexChannel } from "./ws-duplex";

/** The subset of the `bridge:` oRPC router this CLI calls. */
export interface RelayTransport {
	/** Re-fetches the calling bridge token's current persisted startup config
	 * (the same shape `startSession`'s `config` returns) — what a restarting
	 * CLI calls instead of `startSession` again, since minting a new session
	 * would break the seamless reconnect a restart is for (see
	 * `restart-loop.ts`). */
	fetchConfig(): Promise<{
		config: AgentStartConfig | null;
		mcpServers: ResolvedMcpServer[];
		/** R5-T2: the token's assigned skills, resolved server-side by
		 * `resolveSkills` — same "always present, [] when none assigned" contract
		 * as `mcpServers`. */
		skills: ResolvedSkill[];
	}>;
	/** R0-T2: opens the WS duplex channel (see ws-duplex.ts) as an alternative
	 * to `pollCommands`/`pushEvents` — optional so a transport (or a test
	 * fake) that doesn't implement it behaves EXACTLY as it did before R0-T2:
	 * `run-bridge-session.ts` falls back to the unmodified HTTP poll path
	 * whenever this is absent, or resolves `null`, or rejects. */
	openDuplex?(input: {
		afterId: number;
		sessionId: string;
	}): Promise<DuplexChannel | null>;
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
	/** Records (or clears, with null) the session's live VNC endpoint. Optional
	 * so transports/test fakes that don't implement it behave as before — only
	 * the `--cua` path calls it. */
	reportVnc?(input: {
		sessionId: string;
		vncEndpoint: string | null;
	}): Promise<void>;
	startSession(input: { agentKind: string; label?: string }): Promise<{
		config: AgentStartConfig | null;
		mcpServers: ResolvedMcpServer[];
		sessionId: string;
		skills: ResolvedSkill[];
	}>;
}
