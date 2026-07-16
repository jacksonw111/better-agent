import { describe, expect, it, vi } from "vitest";
import {
	CLAUDE_CODE_SESSION_CAPABILITIES,
	CODEX_SESSION_CAPABILITIES,
	PI_SESSION_CAPABILITIES,
} from "../adapters/session-capabilities";
import {
	CONFORMANCE_WORKSPACE,
	CORE_DESCRIPTION,
	conformanceStartContext,
	launchCodexConformance,
	launchPiConformance,
	nextStatusDetail,
} from "./adapter-conformance-harness";

// S4-T4 (master spec §19.4), the other half of adapter-conformance.test.ts:
// (2) the four runtimes are handed ONE core Description — the capability-
// `none` runtimes get a byte-identical context, claude-code differs ONLY by
// Skill Reference expansion, and nothing runtime-specific is compensated in
// (no permission/approval policy text, per §10.2's ban); (4) native
// capability differences are reported as-is via each adapter's own
// session_ready `capabilities` handshake, never masked by the platform.
// Representative difference points (see the S4-T4 report for the rationale):
// the approval surface (codex "gated" vs pi "none" — pi has NO tool-approval
// protocol at all) and the skills surface (codex `skills: false` vs
// claude-code's client-side inline expansion).

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
	query: vi.fn(),
	listSessions: vi.fn(),
}));
vi.mock("../adapters/jsonrpc-io", () => ({ connectJsonRpc: vi.fn() }));
vi.mock("../adapters/process-io", () => ({
	findOnPath: vi.fn(() => "/fake/bin"),
	spawnProcessIo: vi.fn(),
}));

const POLICY_TEXT = /permission|approval/i;

describe("adapter conformance - one shared core description", () => {
	it("capability-none runtimes get a byte-identical context; claude-code differs only by skill expansion", async () => {
		const [claude, codex, opencode, pi] = await Promise.all([
			conformanceStartContext("claude-code"),
			conformanceStartContext("codex"),
			conformanceStartContext("opencode"),
			conformanceStartContext("pi"),
		]);
		expect(opencode).toBe(codex);
		expect(pi).toBe(codex);
		expect(claude).not.toBe(codex);
		expect(claude.startsWith(`${CORE_DESCRIPTION}\n\n`)).toBe(true);
		expect(codex.startsWith(`${CORE_DESCRIPTION}\n\n`)).toBe(true);
		// The shared tail (environment block, workspace line) is identical —
		// nothing runtime-specific was compensated into the context.
		const tail = codex.slice(codex.indexOf("## Agent environment"));
		expect(tail).toContain(`Task workspace: ${CONFORMANCE_WORKSPACE}`);
		expect(claude.endsWith(tail)).toBe(true);
	});

	it("no permission or approval policy text is injected for any runtime (§10.2 ban)", async () => {
		const [claude, codex] = await Promise.all([
			conformanceStartContext("claude-code"),
			conformanceStartContext("codex"),
		]);
		expect(claude).not.toMatch(POLICY_TEXT);
		expect(codex).not.toMatch(POLICY_TEXT);
	});
});

describe("adapter conformance - native capability differences", () => {
	it("codex's session_ready reports its own gated, no-skills surface untouched", async () => {
		const { handle } = await launchCodexConformance();
		const detail = await nextStatusDetail(handle, "session_ready");
		expect(detail.capabilities).toBe(CODEX_SESSION_CAPABILITIES);
	});

	it("pi's session_ready reports approval 'none' — no fabricated approval gate", async () => {
		const { handle, pushLine } = await launchPiConformance();
		pushLine(
			JSON.stringify({
				type: "response",
				command: "get_commands",
				success: true,
				data: { commands: [] },
			})
		);
		const detail = await nextStatusDetail(handle, "session_ready");
		expect(detail.capabilities).toBe(PI_SESSION_CAPABILITIES);
	});

	it("the reported surfaces genuinely differ across runtimes (approvals + skills)", () => {
		expect(CODEX_SESSION_CAPABILITIES.approval).toBe("gated");
		expect(PI_SESSION_CAPABILITIES.approval).toBe("none");
		expect(CODEX_SESSION_CAPABILITIES.skills).toBe(false);
		expect(CLAUDE_CODE_SESSION_CAPABILITIES.skills).toBe(true);
	});
});
