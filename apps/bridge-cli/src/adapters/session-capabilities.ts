// R2-T1: per-adapter `SessionCapabilities` constants (see the type's doc in
// ./types.ts), attached to each adapter's one-time `session_ready` event so
// the web can resolve capabilities from the actually-running adapter first,
// falling back to its own static matrix only when this is absent (old CLI,
// or codex, which doesn't emit session_ready yet — R2-T2's job).

import { PI_THINKING_LEVELS } from "../normalize/pi-commands";
import type { AgentKind, SessionCapabilities } from "./types";

/** claude-code: the SDK's full control surface — live MCP reconfiguration,
 * on-demand quota/context usage, a `list` session op (`listSessions`), and
 * the safe permission-mode subset (see agent-capabilities.ts's doc comment
 * on why `bypassPermissions`/`auto` are excluded). No thinking-level concept
 * — effort is a config-side (startup) knob today, not a live control. */
export const CLAUDE_CODE_SESSION_CAPABILITIES: SessionCapabilities = {
	approval: "gated",
	busyModes: ["queue", "interrupt"],
	// P3-T2: the Agent SDK accepts base64 image content blocks on a user turn.
	images: true,
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
	// P3-T2: not wired for this adapter yet — the composer hides its attach UI.
	images: false,
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
	// P3-T2: pi's `prompt` RPC accepts `images: [{type, data, mimeType}]`
	// (VERIFIED against pi-mono's packages/coding-agent/docs/rpc.md @ main).
	images: true,
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

/** codex (R2-T2): `turn/start`'s approval_policy/sandbox_policy gate every
 * tool call ("gated"), interrupt is `turn/interrupt` (no steer — codex has no
 * mid-turn steering RPC), and MCP servers only apply at `thread/start` (no
 * live reconfigure call, unlike claude-code's `setMcpServers` — "restart").
 * `permissionModes` mirrors `CODEX_APPROVAL_POLICIES` in codex-controls.ts
 * (keep the two in sync). No session-list/fork/tree/compact op, no
 * skills/slash-commands surface, no thinking-level concept. `quota: true` —
 * ASSUMPTION (unverified, no `codex` binary in this sandbox): codex's
 * app-server is assumed to expose an account quota/rate-limit read the way
 * claude's SDK does, though no adapter code calls it yet (R2-T2 only wires
 * the token-usage stream, not a quota RPC). `usage: "stream"` — R2-T2 maps
 * `thread/tokenUsage/updated` onto the same `usage_update` status event
 * opencode streams (see codex-status.ts's `codexUsageUpdateEvent`). */
export const CODEX_SESSION_CAPABILITIES: SessionCapabilities = {
	approval: "gated",
	busyModes: ["queue", "interrupt"],
	// P3-T2: not wired for this adapter yet — the composer hides its attach UI.
	images: false,
	mcp: "restart",
	modelSwitch: true,
	permissionModes: ["untrusted", "on-request", "never"],
	quota: true,
	sessionOps: [],
	skills: false,
	slashCommands: false,
	thinkingLevels: [],
	usage: "stream",
};

/** P3-T2: whether `agentKind`'s adapter can accept downloaded images on
 * `send`/`sendWith` — read by the CLI's image layer (image-input.ts) to strip
 * images (with a visible status note) before they reach an adapter that
 * would silently ignore them. Sourced from the same constants the adapters
 * hand out on `session_ready`, so the two can never drift. */
export function agentSupportsImages(kind: AgentKind): boolean {
	const byKind: Record<AgentKind, SessionCapabilities> = {
		"claude-code": CLAUDE_CODE_SESSION_CAPABILITIES,
		codex: CODEX_SESSION_CAPABILITIES,
		opencode: OPENCODE_SESSION_CAPABILITIES,
		pi: PI_SESSION_CAPABILITIES,
	};
	return byKind[kind].images;
}
