import type { BridgeSessionRow } from "@/utils/api-types";

// Client-side capability model: rather than special-casing "claude" all over
// the terminal UI, every optional surface (session controls, past
// conversations, the slash/skills picker, the usage chip) is gated on a
// per-agent-kind capability matrix, keyed by the session's own `agentKind` —
// no CLI event round-trip needed, since the web already knows which agent a
// session drives from `bridge.listSessions` (see local-agent-detail.tsx).
// Mirrors the shape of `AgentCapabilities` documented in
// `apps/bridge-cli/src/adapters/types.ts` — keep the two field-identical.

type AgentKind = BridgeSessionRow["agentKind"];

/** How a session's cost/token usage becomes available: pushed on the event
 * stream as it happens ("stream" — claude/opencode), only obtainable by
 * asking the agent on demand ("poll" — pi's `get_session_stats` RPC, not yet
 * wired through the bridge), or not available at all ("none"). */
export type UsageMode = "stream" | "poll" | "none";

export interface AgentCapabilities {
	/** `query.getContextUsage()`-style on-demand context percentage. */
	contextUsage: boolean;
	/** Cancels the in-flight turn without ending the session — gates the
	 * Interrupt button (Phase 5). */
	interrupt: boolean;
	/** The agent supports switching models mid-session — gates the model
	 * picker (Phase 5). */
	modelSwitch: boolean;
	/** True ONLY for an agent that runs shell/tool calls with NO approval gate
	 * at all (currently just pi, per `toolApproval`'s doc comment below) —
	 * drives a visible "runs ungated" badge on the session header (RC-T4) so a
	 * user doesn't assume every agent pauses for approval the way claude/
	 * opencode do. */
	noApprovalGate: boolean;
	/** The permission-mode values this agent actually accepts — gates both
	 * whether the dropdown renders at all (empty = hidden) and which options
	 * it offers (Phase 5). */
	permissionModes: string[];
	/** Extended-thinking/reasoning blocks are streamed and worth rendering as a
	 * collapsible "Thinking" section (Phase 1). */
	reasoning: boolean;
	/** The agent's CLI adapter actually implements the `listSessions` control —
	 * gates the "Past conversations" button. Set true ONLY where the adapter
	 * pushes a `session_list` reply (currently just claude-code, see
	 * `apps/bridge-cli/src/adapters/claude-code.ts`'s `makeListSessions`);
	 * otherwise the button would spin forever with no responder. */
	sessionList: boolean;
	/** The agent supports reopening a prior conversation with full context
	 * (claude's `resume`, pi's `switch_session`/`fork`, opencode's
	 * `session.get`). */
	sessionResume: boolean;
	/** The agent exposes a skills list — gates the "/" picker's skill half
	 * (Phase 4). */
	skills: boolean;
	/** The agent exposes a slash-command list — gates the "/" picker's command
	 * half (Phase 4). */
	slashCommands: boolean;
	/** The agent can pause a turn for the user to approve/deny a tool call
	 * (claude/opencode's `canUseTool`/`permission.updated`). pi has no native
	 * hook for this, so its adapter simply never emits an `approval` event —
	 * no separate gate is needed on the approval card itself. */
	toolApproval: boolean;
	/** See `UsageMode` — gates whether the per-turn usage chip renders. */
	usageMode: UsageMode;
}

/** The claude `PermissionMode` values offered as one-click web options —
 * deliberately NOT the SDK's full 6-value enum (mirrored in full by
 * `PERMISSION_MODES` in `apps/bridge-cli/src/adapters/claude-code-startup-
 * config.ts`, which still validates/accepts all 6 for a startup config a user
 * sets deliberately, e.g. via the API/token directly). `bypassPermissions`
 * ("Bypass all permission checks") and `auto` ("Use a model classifier to
 * approve/deny permission prompts") both grant tool execution WITHOUT the
 * web's `canUseTool` human-approval gate — offering them here let a relayed
 * `setPermissionMode` flip a LIVE running session into ungated shell with no
 * re-auth (the T0 audit finding). `dontAsk` stays: per the SDK docs it DENIES
 * unapproved tools rather than granting them, so it can only narrow, not
 * escalate, privilege. */
const CLAUDE_PERMISSION_MODES = ["default", "acceptEdits", "plan", "dontAsk"];

/** opencode's ACP modes — `build` (the default acting mode) and `plan`
 * (read-only planning). Per the §2 research these are the real values, not the
 * earlier-guessed `default`/`plan`; ideally sourced dynamically from ACP
 * `availableModes` later, but hardcoded here until that call is wired. */
const OPENCODE_PERMISSION_MODES = ["build", "plan"];

/** pi has NO permission/approval concept at all ("No permission popups. Run
 * in a container, or build your own confirmation flow...", per its docs) — its
 * menu must stay hidden, so this is empty rather than the earlier-guessed
 * default/plan pair. */
const NO_PERMISSION_MODES: string[] = [];

const CLAUDE_CAPABILITIES: AgentCapabilities = {
	reasoning: true,
	sessionList: true,
	sessionResume: true,
	slashCommands: true,
	skills: true,
	contextUsage: true,
	toolApproval: true,
	noApprovalGate: false,
	modelSwitch: true,
	interrupt: true,
	usageMode: "stream",
	permissionModes: CLAUDE_PERMISSION_MODES,
};

/** pi's RPC mode has no `session.list`-equivalent enumeration and no native
 * tool-approval hook, and only reports usage/cost via an on-demand poll
 * (`get_session_stats`) rather than a stream event. `noApprovalGate: true` —
 * pi runs shell/tool calls with NO approval gate at all (RC-T4): its adapter
 * never emits an `approval` event, so nothing in the web UI would otherwise
 * signal that shell here is unsupervised. */
const PI_CAPABILITIES: AgentCapabilities = {
	reasoning: true,
	sessionList: false,
	sessionResume: true,
	slashCommands: true,
	skills: true,
	contextUsage: true,
	toolApproval: false,
	noApprovalGate: true,
	modelSwitch: true,
	interrupt: true,
	usageMode: "poll",
	permissionModes: NO_PERMISSION_MODES,
};

// opencode's ACP layer can enumerate past sessions, but the CLI adapter here
// doesn't implement the `listSessions` control yet (no `session_list` reply is
// pushed), so the "Past conversations" button stays hidden rather than
// spinning forever. Flip to true once opencode.ts wires that control up.
//
// contextUsage was already true off the streamed `usage_update` events alone;
// R1-b additionally wires a real `getStatus` for both opencode transports —
// ACP caches the latest `usage_update` (see
// apps/bridge-cli/src/adapters/opencode-status.ts) and serve fetches `GET
// /session/:id/message` on demand (see
// apps/bridge-cli/src/adapters/opencode-serve.ts) — so `control: getStatus`
// now answers for opencode too, not just claude/pi/codex.
const OPENCODE_CAPABILITIES: AgentCapabilities = {
	reasoning: true,
	sessionList: false,
	sessionResume: true,
	slashCommands: true,
	skills: true,
	contextUsage: true,
	toolApproval: true,
	noApprovalGate: false,
	modelSwitch: true,
	interrupt: true,
	usageMode: "stream",
	permissionModes: OPENCODE_PERMISSION_MODES,
};

/** codex isn't installed/verified yet — conservative until confirmed:
 * everything off except reasoning (the normalize layer already treats
 * thinking-shaped output generically), interrupt (cancelling a subprocess
 * turn is assumed universal), and now contextUsage (R1-a: the CLI adapter
 * caches `thread/tokenUsage/updated` and answers a `control: getStatus` with
 * a `status_snapshot` carrying it — see `apps/bridge-cli/src/adapters/
 * codex-status.ts` — even though, unlike claude's on-demand
 * `getContextUsage()`, it's a cached last-seen value rather than a fresh
 * read). §2 documents three `approval_policy` values (untrusted / on-request
 * / never), but codex applies them at LAUNCH via `-a`/`-s` flags — there's no
 * verified real-time control — so the menu stays hidden rather than offering
 * a mode it can't actually switch. TODO: surface them once codex's control
 * surface is verified against the running CLI. */
const CODEX_CAPABILITIES: AgentCapabilities = {
	reasoning: true,
	sessionList: false,
	sessionResume: false,
	slashCommands: false,
	skills: false,
	contextUsage: true,
	toolApproval: false,
	noApprovalGate: false,
	modelSwitch: false,
	interrupt: true,
	usageMode: "none",
	permissionModes: NO_PERMISSION_MODES,
};

/** The capability matrix from the pi/opencode research (see plan Phase 0.5) —
 * keyed by the same `AgentKind` the bridge session row already carries. */
export const CAPABILITIES: Record<AgentKind, AgentCapabilities> = {
	"claude-code": CLAUDE_CAPABILITIES,
	pi: PI_CAPABILITIES,
	opencode: OPENCODE_CAPABILITIES,
	codex: CODEX_CAPABILITIES,
};

/** Looks up the capability matrix for a bridge session's `agentKind` — the
 * single entry point the terminal UI gates every optional surface on. */
export function capabilities(kind: AgentKind): AgentCapabilities {
	return CAPABILITIES[kind];
}

/** R2-T1: the CLI's LIVE capability handshake — the wire counterpart of
 * `AgentCapabilities` above, carried on `session_ready`'s `detail.capabilities`
 * once an adapter reports one (every adapter but codex, until R2-T2). Keep
 * field-identical to `apps/bridge-cli/src/adapters/types.ts`'s copy. */
export interface SessionCapabilities {
	approval: "gated" | "none";
	busyModes: ("queue" | "steer" | "interrupt")[];
	mcp: "live" | "restart" | "none";
	modelSwitch: boolean;
	permissionModes: string[];
	quota: boolean;
	sessionOps: ("list" | "fork" | "tree" | "compact")[];
	skills: boolean;
	slashCommands: boolean;
	thinkingLevels: string[];
	usage: UsageMode;
}

/** `AgentCapabilities` plus every `SessionCapabilities` field that isn't
 * already covered by an overlapping name — see `resolveCapabilities`'s merge
 * semantics for which fields the handshake can override vs. only add. */
export interface ResolvedCapabilities extends AgentCapabilities {
	approval: SessionCapabilities["approval"];
	busyModes: SessionCapabilities["busyModes"];
	mcp: SessionCapabilities["mcp"];
	quota: boolean;
	sessionOps: SessionCapabilities["sessionOps"];
	thinkingLevels: string[];
}

/** Conservative defaults for the fields `SessionCapabilities` adds that the
 * old static `AgentCapabilities` matrix has no opinion on — used whenever no
 * live handshake has arrived (old CLI, or a session before session_ready). */
function staticCapabilities(kind: AgentKind): ResolvedCapabilities {
	const base = capabilities(kind);
	return {
		...base,
		approval: base.toolApproval ? "gated" : "none",
		busyModes: base.interrupt ? ["queue", "interrupt"] : ["queue"],
		mcp: "none",
		quota: false,
		sessionOps: base.sessionList ? ["list"] : [],
		thinkingLevels: [],
	};
}

/** The single entry point every terminal/composer/header call site should use
 * instead of the old static `capabilities(kind)` lookup: prefers the LIVE
 * handshake off `session_ready` (`sessionReady?.capabilities`) when present,
 * merging it onto the static matrix by OVERRIDING only the fields the two
 * shapes share (modelSwitch, permissionModes, skills, slashCommands, and
 * usageMode←usage) and ADDING the handshake-only fields (busyModes, mcp,
 * approval, quota, sessionOps, thinkingLevels) — every other static-only flag
 * (reasoning, contextUsage, sessionResume, noApprovalGate, toolApproval,
 * interrupt) stays exactly as the matrix says, since the handshake carries no
 * opinion on them. Falls back to `staticCapabilities` alone when no handshake
 * has arrived yet (old CLI, or codex until R2-T2). */
export function resolveCapabilities(
	kind: AgentKind,
	sessionReady: { capabilities?: SessionCapabilities } | null | undefined
): ResolvedCapabilities {
	const handshake = sessionReady?.capabilities;
	const fallback = staticCapabilities(kind);
	if (!handshake) {
		return fallback;
	}
	return {
		...fallback,
		approval: handshake.approval,
		busyModes: handshake.busyModes,
		mcp: handshake.mcp,
		modelSwitch: handshake.modelSwitch,
		permissionModes: handshake.permissionModes,
		quota: handshake.quota,
		sessionOps: handshake.sessionOps,
		skills: handshake.skills,
		slashCommands: handshake.slashCommands,
		thinkingLevels: handshake.thinkingLevels,
		usageMode: handshake.usage,
	};
}
