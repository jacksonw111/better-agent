import { expect, it } from "vitest";
import { CAPABILITIES, capabilities } from "./agent-capabilities";
import {
	resolveCapabilities,
	type SessionCapabilities,
} from "./resolve-capabilities";

// Phase 0.5: one canonical matrix (from the pi/opencode research in the plan
// doc) every optional Local Agent surface gates on. These assertions pin the
// matrix itself; terminal.test.tsx / terminal-controls.test.tsx cover the UI
// actually gating on it.

it("gives claude the full matrix — every optional surface on, including the full-auto permission mode", () => {
	const claude = capabilities("claude-code");
	expect(claude.reasoning).toBe(true);
	expect(claude.sessionList).toBe(true);
	expect(claude.sessionResume).toBe(true);
	expect(claude.slashCommands).toBe(true);
	expect(claude.skills).toBe(true);
	expect(claude.contextUsage).toBe(true);
	expect(claude.toolApproval).toBe(true);
	expect(claude.modelSwitch).toBe(true);
	expect(claude.interrupt).toBe(true);
	expect(claude.usageMode).toBe("stream");
	expect(claude.permissionModes).toEqual([
		"default",
		"acceptEdits",
		"plan",
		"dontAsk",
		"bypassPermissions",
	]);
});

// Owner request: `bypassPermissions` (full-auto "allow everything") is now an
// offered mode — the CLI spawns with allowDangerouslySkipPermissions so a live
// switch takes effect, and a session in it wears a persistent warning badge.
// `auto` stays OUT: it routes prompts through a model classifier (different
// behavior than the unconditional allow requested), so it is never offered.
it("offers bypassPermissions (full-auto) but never auto as web-selectable claude permission modes", () => {
	const claude = capabilities("claude-code");
	expect(claude.permissionModes).toContain("bypassPermissions");
	expect(claude.permissionModes).not.toContain("auto");
});

it("gives pi no session-list or tool-approval, a poll usage mode, and no permission menu (pi has no approval concept)", () => {
	const pi = capabilities("pi");
	expect(pi.sessionList).toBe(false);
	expect(pi.toolApproval).toBe(false);
	expect(pi.usageMode).toBe("poll");
	// pi explicitly has NO permission/approval flow (§2) — the menu stays hidden.
	expect(pi.permissionModes).toEqual([]);
	// Still supports these, per the research matrix.
	expect(pi.sessionResume).toBe(true);
	expect(pi.slashCommands).toBe(true);
	expect(pi.skills).toBe(true);
	expect(pi.modelSwitch).toBe(true);
	expect(pi.interrupt).toBe(true);
});

// RC-T4: pi runs shell/tool calls with NO approval gate at all — the badge
// this drives on the session header is the only user-visible signal of that.
it("flags pi (and only pi) as running with no approval gate at all (RC-T4)", () => {
	expect(capabilities("pi").noApprovalGate).toBe(true);
	expect(capabilities("claude-code").noApprovalGate).toBe(false);
	expect(capabilities("opencode").noApprovalGate).toBe(false);
	expect(capabilities("codex").noApprovalGate).toBe(false);
});

it("gives opencode tool-approval and a stream usage mode, with build/plan permission modes (§2)", () => {
	const opencode = capabilities("opencode");
	// The opencode CLI adapter doesn't push a `session_list` reply yet, so the
	// "Past conversations" button must stay hidden (else it spins forever).
	expect(opencode.sessionList).toBe(false);
	expect(opencode.toolApproval).toBe(true);
	expect(opencode.usageMode).toBe("stream");
	// §2 correction: opencode's real ACP modes are build/plan, not default/plan.
	expect(opencode.permissionModes).toEqual(["build", "plan"]);
});

it("keeps codex's static matrix conservative on the session/tool-approval surface, but live on model/permission/usage (R2-T2)", () => {
	const codex = capabilities("codex");
	expect(codex.reasoning).toBe(true);
	expect(codex.interrupt).toBe(true);
	expect(codex.sessionList).toBe(false);
	expect(codex.sessionResume).toBe(false);
	expect(codex.slashCommands).toBe(false);
	expect(codex.skills).toBe(false);
	// R1-a: the CLI adapter now caches token usage from `thread/tokenUsage/
	// updated` and answers `getStatus` with it — see codex-status.ts.
	expect(codex.contextUsage).toBe(true);
	expect(codex.toolApproval).toBe(false);
	// R2-T2: setModel/setPermissionMode apply PER-TURN (codexTurnStartParams),
	// and thread/tokenUsage/updated streams into usage_update — see
	// codex-controls.ts / codex-status.ts.
	expect(codex.modelSwitch).toBe(true);
	expect(codex.usageMode).toBe("stream");
	expect(codex.permissionModes).toEqual(["untrusted", "on-request", "never"]);
});

it("defines every known agent kind", () => {
	const knownKinds = ["claude-code", "opencode", "codex", "pi"] as const;
	for (const kind of knownKinds) {
		expect(CAPABILITIES[kind]).toBeDefined();
	}
});

// RC-T4: pi runs shell/tool calls with NO approval gate at all — the badge
// this drives on the session header is the only user-visible signal of that.
it("flags pi (and only pi) as running with no approval gate at all (RC-T4)", () => {
	expect(capabilities("pi").noApprovalGate).toBe(true);
	expect(capabilities("claude-code").noApprovalGate).toBe(false);
	expect(capabilities("opencode").noApprovalGate).toBe(false);
	expect(capabilities("codex").noApprovalGate).toBe(false);
});

// R2-T1: the capability handshake — resolveCapabilities prefers whatever the
// LIVE session_ready carried over the web's own static matrix, and falls back
// to that matrix alone for old CLIs (or codex, which emits no handshake yet).
const HANDSHAKE: SessionCapabilities = {
	approval: "none",
	busyModes: ["queue", "steer", "interrupt"],
	mcp: "none",
	modelSwitch: true,
	permissionModes: [],
	quota: false,
	sessionOps: [],
	skills: true,
	slashCommands: true,
	thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
	usage: "poll",
};

it("falls back to the static matrix when no session_ready has arrived", () => {
	const resolved = resolveCapabilities("claude-code", null);
	const claude = capabilities("claude-code");
	expect(resolved.permissionModes).toEqual(claude.permissionModes);
	expect(resolved.reasoning).toBe(claude.reasoning);
	expect(resolved.mcp).toBe("none");
	expect(resolved.thinkingLevels).toEqual([]);
});

it("falls back to the static matrix when session_ready carries no capabilities", () => {
	const resolved = resolveCapabilities("pi", { capabilities: undefined });
	expect(resolved.usageMode).toBe("poll");
	expect(resolved.mcp).toBe("none");
});

it("prefers the handshake's overlapping fields over the static matrix", () => {
	// claude's static matrix has permissionModes/usageMode wildly different
	// from HANDSHAKE's — proves the handshake, not the matrix, wins.
	const resolved = resolveCapabilities("claude-code", {
		capabilities: HANDSHAKE,
	});
	expect(resolved.permissionModes).toEqual([]);
	expect(resolved.usageMode).toBe("poll");
	expect(resolved.skills).toBe(true);
	expect(resolved.slashCommands).toBe(true);
	expect(resolved.modelSwitch).toBe(true);
});

it("adds the handshake-only fields (busyModes/mcp/approval/quota/sessionOps/thinkingLevels)", () => {
	const resolved = resolveCapabilities("pi", { capabilities: HANDSHAKE });
	expect(resolved.busyModes).toEqual(["queue", "steer", "interrupt"]);
	expect(resolved.mcp).toBe("none");
	expect(resolved.approval).toBe("none");
	expect(resolved.quota).toBe(false);
	expect(resolved.sessionOps).toEqual([]);
	expect(resolved.thinkingLevels).toEqual([
		"off",
		"minimal",
		"low",
		"medium",
		"high",
		"xhigh",
		"max",
	]);
});

// P4-T1: the "Past conversations" gate now follows the LIVE handshake —
// codex/opencode/pi CLIs that grew the on-disk session scanners report
// `sessionOps: ["list"]`, older CLIs report `[]` (or nothing at all).
it("derives sessionList from the handshake's sessionOps when one is present", () => {
	const withList = resolveCapabilities("codex", {
		capabilities: { ...HANDSHAKE, sessionOps: ["list"] },
	});
	expect(withList.sessionList).toBe(true);
	// Even claude loses the button when ITS live handshake says no list op.
	const withoutList = resolveCapabilities("claude-code", {
		capabilities: HANDSHAKE,
	});
	expect(withoutList.sessionList).toBe(false);
});

// P4-T5: same derivation for the ⌘K content search — only a live handshake
// listing the "search" op enables it; pre-P4-T5 CLIs never do.
it("derives sessionSearch from the handshake's sessionOps and defaults it off", () => {
	const withSearch = resolveCapabilities("codex", {
		capabilities: { ...HANDSHAKE, sessionOps: ["list", "search"] },
	});
	expect(withSearch.sessionSearch).toBe(true);
	const withoutSearch = resolveCapabilities("codex", {
		capabilities: { ...HANDSHAKE, sessionOps: ["list"] },
	});
	expect(withoutSearch.sessionSearch).toBe(false);
	expect(resolveCapabilities("claude-code", null).sessionSearch).toBe(false);
});

it("keeps the static claude-only sessionList gating when no handshake arrived (old CLI)", () => {
	expect(resolveCapabilities("codex", null).sessionList).toBe(false);
	expect(resolveCapabilities("opencode", null).sessionList).toBe(false);
	expect(resolveCapabilities("pi", null).sessionList).toBe(false);
	expect(resolveCapabilities("claude-code", null).sessionList).toBe(true);
});

it("keeps static-only fields (reasoning, sessionResume, noApprovalGate, contextUsage) untouched by the handshake", () => {
	const resolved = resolveCapabilities("claude-code", {
		capabilities: HANDSHAKE,
	});
	const claude = capabilities("claude-code");
	expect(resolved.reasoning).toBe(claude.reasoning);
	expect(resolved.sessionResume).toBe(claude.sessionResume);
	expect(resolved.noApprovalGate).toBe(claude.noApprovalGate);
	expect(resolved.contextUsage).toBe(claude.contextUsage);
});

// P4-T2: the Shell tab is gated on the CLI's live `shell` capability — false
// for an old CLI (no handshake, or one predating the field), true only when a
// P4-T2+ handshake reports it.
it("resolves shell false without a handshake (old CLI)", () => {
	expect(resolveCapabilities("claude-code", null).shell).toBe(false);
	expect(resolveCapabilities("pi", { capabilities: HANDSHAKE }).shell).toBe(
		false
	);
});

it("resolves shell true when the handshake reports it", () => {
	const resolved = resolveCapabilities("claude-code", {
		capabilities: { ...HANDSHAKE, shell: true },
	});
	expect(resolved.shell).toBe(true);
});

// P4-T3: the Files tab / @file picker mirror the shell gating on `fs`.
it("resolves fs false without a handshake, true when reported", () => {
	expect(resolveCapabilities("claude-code", null).fs).toBe(false);
	expect(resolveCapabilities("pi", { capabilities: HANDSHAKE }).fs).toBe(false);
	const resolved = resolveCapabilities("claude-code", {
		capabilities: { ...HANDSHAKE, fs: true },
	});
	expect(resolved.fs).toBe(true);
});

// P4-T4: the Git tab mirrors the shell/fs gating on `git`.
it("resolves git false without a handshake, true when reported", () => {
	expect(resolveCapabilities("claude-code", null).git).toBe(false);
	expect(resolveCapabilities("pi", { capabilities: HANDSHAKE }).git).toBe(
		false
	);
	const resolved = resolveCapabilities("claude-code", {
		capabilities: { ...HANDSHAKE, git: true },
	});
	expect(resolved.git).toBe(true);
});
