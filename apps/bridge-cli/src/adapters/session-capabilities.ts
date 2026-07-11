// R2-T1: per-adapter `SessionCapabilities` constants (see the type's doc in
// ./types.ts), attached to each adapter's one-time `session_ready` event so
// the web can resolve capabilities from the actually-running adapter first,
// falling back to its own static matrix only when this is absent (old CLI,
// or codex, which doesn't emit session_ready yet — R2-T2's job).

import { PI_THINKING_LEVELS } from "../normalize/pi-commands";
import type { SessionCapabilities } from "./types";

/** claude-code: the SDK's full control surface — live MCP reconfiguration,
 * on-demand quota/context usage, a `list` session op (`listSessions`), and
 * the safe permission-mode subset (see agent-capabilities.ts's doc comment
 * on why `bypassPermissions`/`auto` are excluded). No thinking-level concept
 * — effort is a config-side (startup) knob today, not a live control. */
export const CLAUDE_CODE_SESSION_CAPABILITIES: SessionCapabilities = {
	approval: "gated",
	busyModes: ["queue", "interrupt"],
	mcp: "live",
	modelSwitch: true,
	permissionModes: ["default", "acceptEdits", "plan", "dontAsk"],
	quota: true,
	sessionOps: ["list"],
	skills: true,
	slashCommands: true,
	thinkingLevels: [],
	usage: "stream",
};

/** opencode — shared by both transports. MCP only takes effect after a
 * restart (serve's live `POST /mcp` isn't wired through this adapter yet); no
 * on-demand quota or session-list. `permissionModes` here is the ACP static
 * pair (build/plan); opencode-serve.ts overrides it with the LIVE list `GET
 * /agent` reports (R2-T3) when it attaches this constant to its own
 * session_ready. */
export const OPENCODE_SESSION_CAPABILITIES: SessionCapabilities = {
	approval: "gated",
	busyModes: ["queue", "interrupt"],
	mcp: "restart",
	modelSwitch: true,
	permissionModes: ["build", "plan"],
	quota: false,
	sessionOps: [],
	skills: true,
	slashCommands: true,
	thinkingLevels: [],
	usage: "stream",
};

/** pi — no approval gate, no MCP, no session-list/quota, but (R2-T3) a full
 * queue/steer/interrupt busy surface and the full 7-value thinking-level
 * vocabulary pi's `set_thinking_level` accepts (xhigh/max are model-gated but
 * still listed — the UI shows what the command accepts, see
 * pi-controls.ts). Usage only via an on-demand poll (`get_session_stats`),
 * never streamed. */
export const PI_SESSION_CAPABILITIES: SessionCapabilities = {
	approval: "none",
	busyModes: ["queue", "steer", "interrupt"],
	mcp: "none",
	modelSwitch: true,
	permissionModes: [],
	quota: false,
	sessionOps: [],
	skills: true,
	slashCommands: true,
	thinkingLevels: [...PI_THINKING_LEVELS],
	usage: "poll",
};
