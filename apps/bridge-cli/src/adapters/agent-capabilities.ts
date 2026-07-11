// `AgentCapabilities` — split out of types.ts purely to keep that file under
// the repo's 300-line file cap (R3-T1 needed the room back for
// `AgentHandle.sendWith`/`TextWhen`). Superseded by `SessionCapabilities`
// (R2-T1, still in types.ts) but kept around as the shape both this CLI and
// the web's static fallback matrix stay in sync against — see the doc
// comment below for why it still exists.

import type { UsageMode } from "./types";

/**
 * What one adapter's underlying agent actually supports, independent of the
 * normalized event model every adapter maps onto (message/output/tool/file/
 * status/error/approval always applies). The web gates every OPTIONAL
 * surface — session controls, "Past conversations", the slash/skills picker,
 * the usage chip — on this, keyed by `AgentKind`, so no agent is special-cased
 * in the UI. This type isn't currently read by anything server-side (the web
 * looks its copy up client-side, keyed by the session's already-known
 * `agentKind`, rather than round-tripping a capabilities event) — kept here
 * so both sides have one canonical shape to keep in sync against.
 */
export interface AgentCapabilities {
	/** `getContextUsage()`-style on-demand context percentage. */
	contextUsage: boolean;
	/** Cancels the in-flight turn without ending the session. */
	interrupt: boolean;
	/** Switching models mid-session. */
	modelSwitch: boolean;
	/** The permission-mode values this agent actually accepts; empty means the
	 * agent has no such concept at all. */
	permissionModes: string[];
	/** Extended-thinking/reasoning blocks are streamed. */
	reasoning: boolean;
	/** The agent can enumerate the user's past local conversations. */
	sessionList: boolean;
	/** The agent supports reopening a prior conversation with full context. */
	sessionResume: boolean;
	/** The agent exposes a skills list. */
	skills: boolean;
	/** The agent exposes a slash-command list. */
	slashCommands: boolean;
	/** The agent can pause a turn for the user to approve/deny a tool call. */
	toolApproval: boolean;
	/** See `UsageMode`. */
	usageMode: UsageMode;
}
