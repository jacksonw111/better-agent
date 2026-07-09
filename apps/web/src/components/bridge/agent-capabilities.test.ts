import { expect, it } from "vitest";
import { CAPABILITIES, capabilities } from "./agent-capabilities";

// Phase 0.5: one canonical matrix (from the pi/opencode research in the plan
// doc) every optional Local Agent surface gates on. These assertions pin the
// matrix itself; terminal.test.tsx / terminal-controls.test.tsx cover the UI
// actually gating on it.

it("gives claude the full matrix — every optional surface on, the safe permission-mode subset", () => {
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
	]);
});

// T0 security regression: `bypassPermissions`/`auto` both grant tool
// execution without the web's `canUseTool` approval gate — a relayed
// `setPermissionMode` offering them as one-click LIVE options would flip a
// running session into ungated shell with no re-auth. They must never
// reappear in the web-selectable set, however the safe subset above evolves.
it("never offers bypassPermissions or auto as web-selectable claude permission modes", () => {
	const claude = capabilities("claude-code");
	expect(claude.permissionModes).not.toContain("bypassPermissions");
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

it("keeps codex conservative — everything off except reasoning, interrupt, and (R1-a) contextUsage; permission menu hidden (§2 approval_policy is launch-only)", () => {
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
	expect(codex.modelSwitch).toBe(false);
	expect(codex.usageMode).toBe("none");
	// §2 lists three approval_policy values, but codex sets them at launch —
	// no verified real-time switch, so the menu stays hidden for now.
	expect(codex.permissionModes).toEqual([]);
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
