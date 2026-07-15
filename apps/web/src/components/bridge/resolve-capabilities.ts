import type { BridgeSessionRow } from "@/utils/api-types";
import {
	type AgentCapabilities,
	capabilities,
	type UsageMode,
} from "./agent-capabilities";

// The live-handshake half of the capability model, split out of
// agent-capabilities.ts (which sits at the repo's 300-line cap; that file
// re-exports everything here so existing imports keep working): the CLI's
// `session_ready` handshake shape, its merge onto the static matrix, and the
// conservative pre-handshake defaults.

type AgentKind = BridgeSessionRow["agentKind"];

/** R3-T1: the busy-turn send policies a composer send can carry — mirrors
 * `TextWhen` in `apps/bridge-cli/src/adapters/types.ts`. Also the element type
 * of `SessionCapabilities.busyModes` below, i.e. the set of modes a given
 * agent actually supports (pi reports all three; claude-code/opencode/codex
 * report `["queue", "interrupt"]` — "steer" is never offered for them). */
export type TextWhen = "queue" | "steer" | "interrupt";

/** R2-T1: the CLI's LIVE capability handshake — the wire counterpart of
 * `AgentCapabilities`, carried on `session_ready`'s `detail.capabilities`
 * once an adapter reports one (every adapter but codex, until R2-T2). Keep
 * field-identical to `apps/bridge-cli/src/adapters/types.ts`'s copy. */
export interface SessionCapabilities {
	approval: "gated" | "none";
	busyModes: TextWhen[];
	/** P4-T3: CLI answers `fsList`/`fsRead` (Files tab, @file picker); a
	 * pre-P4-T3 handshake omits → false. */
	fs?: boolean;
	/** P4-T4: CLI answers `gitStatus`/`gitDiff`/`gitCommit` (Git tab); a
	 * pre-P4-T4 handshake omits → false. */
	git?: boolean;
	/** P3-T2: adapter can inject images; a pre-P3-T2 handshake omits → false. */
	images?: boolean;
	mcp: "live" | "restart" | "none";
	modelSwitch: boolean;
	permissionModes: string[];
	quota: boolean;
	sessionOps: ("list" | "fork" | "tree" | "compact")[];
	/** P4-T2: CLI answers `runShell` (Shell tab); old handshakes omit → false. */
	shell?: boolean;
	skills: boolean;
	slashCommands: boolean;
	thinkingLevels: string[];
	usage: UsageMode;
}

/** `AgentCapabilities` plus every `SessionCapabilities` field that isn't
 * already covered by an overlapping name — see `resolveCapabilities`. */
export interface ResolvedCapabilities extends AgentCapabilities {
	approval: SessionCapabilities["approval"];
	busyModes: SessionCapabilities["busyModes"];
	/** P4-T3: gates the Files tab + @file picker; only a live handshake
	 * enables it. */
	fs: boolean;
	/** P4-T4: gates the Git tab; only a P4-T4+ handshake enables it. */
	git: boolean;
	/** P3-T2: gates the attach surface; only a live handshake enables it. */
	images: boolean;
	mcp: SessionCapabilities["mcp"];
	quota: boolean;
	sessionOps: SessionCapabilities["sessionOps"];
	/** P4-T2: gates the Shell tab; only a P4-T2+ handshake enables it. */
	shell: boolean;
	thinkingLevels: string[];
}

/** Conservative defaults for the handshake-only fields, pre-handshake. */
function staticCapabilities(kind: AgentKind): ResolvedCapabilities {
	const base = capabilities(kind);
	return {
		...base,
		approval: base.toolApproval ? "gated" : "none",
		busyModes: base.interrupt ? ["queue", "interrupt"] : ["queue"],
		fs: false,
		git: false,
		images: false,
		mcp: "none",
		quota: false,
		sessionOps: base.sessionList ? ["list"] : [],
		shell: false,
		thinkingLevels: [],
	};
}

/** The single entry point every terminal/composer/header call site should use
 * instead of the old static `capabilities(kind)` lookup: prefers the LIVE
 * handshake off `session_ready` (`sessionReady?.capabilities`) when present,
 * merging it onto the static matrix — the shared fields below OVERRIDE, the
 * handshake-only fields ADD, and every other static-only flag (reasoning,
 * contextUsage, sessionResume, noApprovalGate, toolApproval, interrupt) stays
 * exactly as the matrix says, since the handshake carries no opinion on them.
 * Falls back to `staticCapabilities` alone when no handshake has arrived yet
 * (old CLI, or codex until R2-T2). */
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
		fs: handshake.fs ?? false,
		git: handshake.git ?? false,
		images: handshake.images ?? false,
		mcp: handshake.mcp,
		modelSwitch: handshake.modelSwitch,
		permissionModes: handshake.permissionModes,
		quota: handshake.quota,
		sessionList: handshake.sessionOps.includes("list"),
		sessionOps: handshake.sessionOps,
		shell: handshake.shell ?? false,
		skills: handshake.skills,
		slashCommands: handshake.slashCommands,
		thinkingLevels: handshake.thinkingLevels,
		usageMode: handshake.usage,
	};
}
