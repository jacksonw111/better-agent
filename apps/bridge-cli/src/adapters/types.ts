import type { NormalizedEvent } from "../normalize/types";

/** Which local coding agent a bridge session drives. Mirrors `AGENT_KINDS`
 * in `packages/api/src/routers/bridge.ts` — keep the two in sync. */
export type AgentKind = "claude-code" | "opencode" | "codex" | "pi";

/** Which wire protocol drives the opencode agent: `acp` (the default —
 * `opencode acp` over stdio JSON-RPC, the battle-tested path) or `serve`
 * (`opencode serve` over HTTP + SSE, opt-in via `--opencode-transport serve`;
 * its wire shapes are still unverified against a real binary — see
 * opencode-serve.ts). Ignored by every other agent kind. */
export type OpencodeTransport = "acp" | "serve";

export const OPENCODE_TRANSPORTS: readonly OpencodeTransport[] = [
	"acp",
	"serve",
];

/** How a session's cost/token usage becomes available: pushed on the event
 * stream as it happens ("stream"), only obtainable by asking the agent on
 * demand ("poll"), or not available at all ("none"). Mirrored field-for-field
 * by the web's own copy in
 * `apps/web/src/components/bridge/agent-capabilities.ts` — the web isn't a
 * workspace package this CLI can import, so it keeps a duplicate rather than
 * a shared import; keep the two in sync. */
export type UsageMode = "stream" | "poll" | "none";

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

/** R2-T1: what one adapter's underlying agent ACTUALLY supports, reported
 * live on `session_ready`'s `detail.capabilities` — the wire counterpart of
 * `AgentCapabilities` above, which the web falls back to when this is absent
 * (old CLI, or an adapter — currently just codex, until R2-T2 — that doesn't
 * emit `session_ready` yet). Mirrored by the web's own copy in
 * `apps/web/src/components/bridge/agent-capabilities.ts` — keep in sync. */
export interface SessionCapabilities {
	/** Tool calls pause for approval ("gated") or never do ("none" — pi). */
	approval: "gated" | "none";
	/** Mid-turn interruption: queued follow-up, live steer, hard interrupt. */
	busyModes: ("queue" | "steer" | "interrupt")[];
	/** MCP servers: swappable LIVE, only after a restart, or unsupported. */
	mcp: "live" | "restart" | "none";
	/** Switching models mid-session. */
	modelSwitch: boolean;
	/** Permission-mode values this agent accepts; empty = no such concept. */
	permissionModes: string[];
	/** Can fetch the account's quota/rate-limit windows on demand. */
	quota: boolean;
	/** Session-management operations the agent supports. */
	sessionOps: ("list" | "fork" | "tree" | "compact")[];
	/** The agent exposes a skills list. */
	skills: boolean;
	/** The agent exposes a slash-command list. */
	slashCommands: boolean;
	/** Thinking/reasoning effort levels accepted; empty = no such concept. */
	thinkingLevels: string[];
	/** See `UsageMode`. */
	usage: UsageMode;
}

/** `status` value pushed on `events` right before it's closed, whenever the
 * underlying process exits on its own — a crash, or the agent simply
 * finishing its work — so the web UI (and CLI stdout) sees an explicit "the
 * process is gone" marker instead of the feed just going quiet. Shared by
 * all three adapters' `onExit`/`rpc.onExit` wiring. */
export const AGENT_EXITED_STATUS = "agent_exited";

/** `status` value each adapter pushes in reply to a `control: getStatus`
 * command (Phase R1's normalized on-demand status surface) — the web renders
 * its `detail` (a `StatusSnapshotDetail`) as one uniform status line, no
 * agent-specific casing. */
export const STATUS_SNAPSHOT_STATUS = "status_snapshot";

/** Context-window occupancy: `used`/`size` are token counts, `pct` is the
 * agent-reported (or adapter-derived) used/size percentage, 0–100. */
export interface StatusSnapshotContextUsage {
	pct?: number;
	size?: number;
	used?: number;
}

/** Session-total token buckets — each optional since not every agent reports
 * every bucket (e.g. codex has no cacheWrite figure). */
export interface StatusSnapshotTokens {
	cacheRead?: number;
	cacheWrite?: number;
	input?: number;
	output?: number;
}

/**
 * The normalized on-demand status model (plan §3.3): every field optional —
 * each adapter fills exactly what its agent can answer (claude:
 * `getContextUsage`/`mcpServerStatus`; pi: `get_session_stats`/`get_state`;
 * codex: cached `thread/tokenUsage/updated` + `thread/status/changed`), and
 * the web renders whatever arrived rather than gating on completeness.
 */
export interface StatusSnapshotDetail {
	contextUsage?: StatusSnapshotContextUsage;
	costUsd?: number;
	mcpServers?: { name: string; status: string }[];
	model?: string;
	permissionMode?: string;
	/** True while the agent is actively generating (pi's `isStreaming`, codex's
	 * thread status); absent when the agent doesn't report it. */
	running?: boolean;
	tokens?: StatusSnapshotTokens;
}

/** A running agent process, already normalizing its own output. */
export interface AgentHandle {
	/**
	 * Answers a pending `ApprovalEvent` (previously emitted on `events`) with
	 * the id of the option the user picked, and sends the corresponding reply
	 * on the agent's underlying protocol. A `requestId` that's unknown or
	 * already answered is a no-op that instead emits a `status` warning event
	 * — the request may have already been resolved (e.g. the agent moved on)
	 * by the time the user answers.
	 */
	answerApproval(requestId: string, optionId: string): void;
	/** Normalized events, in emission order. Completes when the agent exits. */
	events: AsyncIterable<NormalizedEvent>;
	/**
	 * Asks the agent for its current status (context usage, cost/tokens, MCP
	 * servers, running/idle — whatever it can answer) and pushes ONE
	 * `STATUS_SNAPSHOT_STATUS` status event carrying a `StatusSnapshotDetail`.
	 * Fire-and-forget like `listSessions`: the web's `control: getStatus`
	 * command gets its answer on the event stream, never as a return value.
	 * Optional — see `interrupt`; claude-code/pi/codex implement it.
	 */
	getStatus?(): void;
	/**
	 * Cancels the in-flight turn but keeps the session alive — distinct from
	 * `stop`, which ends the session outright. Every adapter implements it
	 * (claude-code via the SDK's `query.interrupt()`, codex's `turn/interrupt`,
	 * opencode's ACP `session/cancel`, pi's `{type:"abort"}` stdin frame), but
	 * it stays optional here — the CLI's `CommandSink` routing (see
	 * `apps/bridge-cli/src/commands.ts`) treats a missing `interrupt` as a
	 * no-op rather than an error — so a future adapter without one degrades
	 * safely instead of crashing.
	 */
	interrupt?(): void;
	/**
	 * Fetches the user's past local conversations for this agent (e.g. claude's
	 * `listSessions({dir})`) and pushes them onto `events` as a curated
	 * `session_list` status event. Optional — see `interrupt` for why not every
	 * adapter implements the control methods; only claude-code currently does.
	 */
	listSessions?(): void;
	/**
	 * Reloads the session's skills from disk LIVE (R4), no restart — after the
	 * CLI has (re)written the SKILL.md files. Only claude-code implements it
	 * (`query.reloadSkills`); other agents pick up skill changes on their next
	 * restart, so they omit it (a missing method is the `CommandSink`'s normal
	 * no-op). The skills a session first launched with are written + enabled by
	 * `Adapter.start` from `StartOptions.skills`, not here.
	 */
	reloadSkills?(): void;
	/** Feeds a user command (from the web UI, relayed through the server) to the agent. */
	send(text: string): void;
	/**
	 * Replaces the session's MCP servers LIVE (R5-b), no restart. Only adapters
	 * whose agent supports live MCP reconfiguration implement it — claude-code
	 * (`query.setMcpServers`) and opencode-serve (`POST /mcp`); codex applies at
	 * start and pi has no native MCP, so both omit it (a missing method is the
	 * `CommandSink`'s normal no-op, like `interrupt`). The `mcpServers` a
	 * session first launched with are applied by `Adapter.start` from
	 * `StartOptions.mcpServers`, not here.
	 */
	setMcpServers?(servers: ResolvedMcpServer[]): void;
	/**
	 * Switches the model used for subsequent turns. Optional — see `interrupt`
	 * for why not every adapter implements the control methods.
	 */
	setModel?(model: string): void;
	/**
	 * Switches the session's permission mode (e.g. "default", "plan",
	 * "acceptEdits"). Optional — see `interrupt` for why not every adapter
	 * implements the control methods.
	 */
	setPermissionMode?(mode: string): void;
	/**
	 * Switches the extended-thinking/reasoning effort level for subsequent
	 * turns (pi's `set_thinking_level`, R2-T3 item 2). Optional — see
	 * `interrupt` for why not every adapter implements the control methods;
	 * only pi does today.
	 */
	setThinking?(level: string): void;
	/** Terminates the agent process and releases its resources. */
	stop(): void;
}

/** Options that shape how `Adapter.start` begins a session. */
export interface StartOptions {
	/** Persisted startup config fetched from the server at session start
	 * (Phase 4): `appendSystemPrompt` (claude's SDK option), `maxTurns`, … Adapters
	 * apply only the fields they support; unknown fields are ignored. */
	config?: AgentStartConfig;
	/** The MCP servers to launch this session with (R5-b), already resolved
	 * server-side by `resolveMcpServers` (auth decrypted) and forwarded by the
	 * CLI. Each adapter applies the subset it supports: claude-code and
	 * opencode-serve at start (and again LIVE via `AgentHandle.setMcpServers`),
	 * codex writes them into its per-turn config, pi has no native MCP and
	 * ignores them. Empty/absent → the agent's own configured servers only. */
	mcpServers?: ResolvedMcpServer[];
	/** A prior conversation id to resume, from `--resume` (see args.ts). Only
	 * claude-code's adapter honors this; every other adapter's `start` simply
	 * doesn't declare the parameter, so it's a no-op for them by construction. */
	resume?: string;
	/** The skills to install for this session (R4), resolved server-side by
	 * `resolveSkills` from the token's `config.skills`. The adapter writes each
	 * as a `SKILL.md` under the agent's skills dir at start; claude-code then
	 * enables them (SDK `skills` option) and can reload them LIVE via
	 * `AgentHandle.reloadSkills`. Empty/absent → only the agent's own on-disk
	 * skills. */
	skills?: ResolvedSkill[];
}

/** An MCP server resolved server-side (`resolveMcpServers` in
 * `packages/api`), redeclared locally so the CLI takes no runtime dep on the
 * API package — same reason `AgentStartConfig` is redeclared. `headers`
 * already carries the decrypted `Authorization` (never the ciphertext); the
 * transport is HTTP (`type: "http"` in the SDK/agent config the adapters
 * build). */
export interface ResolvedMcpServer {
	headers: Record<string, string>;
	name: string;
	url: string;
}

/** A skill resolved server-side (`resolveSkills` in `packages/api`) into the
 * three parts a `SKILL.md` needs — its frontmatter `name`/`description` and
 * the markdown body (`instructions`). Redeclared locally so the CLI takes no
 * runtime dep on the API package (same reason as `ResolvedMcpServer`). */
export interface ResolvedSkill {
	description: string;
	instructions: string;
	name: string;
}

/** Startup config the bridge CLI forwards to an adapter (a subset of the
 * server's `BridgeTokenConfig`, redeclared locally so the CLI doesn't take a
 * runtime dep on `@better-agent/agent`). */
export interface AgentStartConfig {
	appendSystemPrompt?: string;
	effort?: "low" | "medium" | "high" | "xhigh" | "max";
	maxBudgetUsd?: number;
	maxTurns?: number;
	/** The model id to start the session with. Only claude-code applies this
	 * (SDK `Options.model`) as of R2-b; see per-adapter notes for the rest. */
	model?: string;
	/** The permission mode to start the session with (agent-specific values,
	 * e.g. claude's "default"/"plan"/"acceptEdits"/…). Only claude-code applies
	 * this as of R2-b — ignored (not just unsupported) by pi, which has no
	 * permission-mode concept at all. */
	permissionMode?: string;
}

/** Spawns and wires up one local coding agent in `dir`. */
export interface Adapter {
	start(dir: string, opts?: StartOptions): Promise<AgentHandle>;
}
