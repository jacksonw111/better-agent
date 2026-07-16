import { describe, expect, it, vi } from "vitest";
import { connectJsonRpc } from "../adapters/jsonrpc-io";
import { spawnProcessIo } from "../adapters/process-io";
import {
	ALPHA_BODY,
	BETA_BODY,
	CONFORMANCE_WORKSPACE,
	CORE_DESCRIPTION,
	claudeFirstTurnText,
	launchClaudeConformance,
	launchCodexConformance,
	launchOpencodeConformance,
	launchPiConformance,
	piPromptText,
	requestParams,
	textBlockOf,
} from "./adapter-conformance-harness";

// S4-T4 (master spec §19.4): ONE shared Task Start Context input, driven
// through all four adapters' REAL start paths (run-session supplier + the
// real selectAdapter; only the process/SDK wire is faked). Asserted here, per
// adapter: (1) the runtime starts in the launch-prepared workspace, (2) the
// injected first input carries the SAME core Description verbatim, (3) the
// two Skill References inline only for claude-code (the `discoverable`
// runtime) and stay verbatim `/text` for the capability-`none` runtimes —
// never a faked expansion. Capability-difference conformance lives in
// adapter-conformance-capabilities.test.ts.

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
	query: vi.fn(),
	listSessions: vi.fn(),
}));
vi.mock("../adapters/jsonrpc-io", () => ({ connectJsonRpc: vi.fn() }));
vi.mock("../adapters/process-io", () => ({
	findOnPath: vi.fn(() => "/fake/bin"),
	spawnProcessIo: vi.fn(),
}));

const SKILL_SENTENCE = "Apply /alpha and /beta before starting.";

describe("adapter conformance - claude-code", () => {
	it("starts the SDK session in the launch-prepared workspace", async () => {
		const { harness } = await launchClaudeConformance();
		expect(harness.options?.cwd).toBe(CONFORMANCE_WORKSPACE);
	});

	it("receives the context as its first turn, both Skill References inlined", async () => {
		const { harness, startContext } = await launchClaudeConformance();
		const text = await claudeFirstTurnText(harness.prompt);
		expect(text).toBe(startContext);
		expect(text).toContain(CORE_DESCRIPTION);
		expect(text).toContain(ALPHA_BODY);
		expect(text).toContain(BETA_BODY);
		expect(text).not.toContain("/alpha");
		expect(text).not.toContain("/beta");
	});
});

describe("adapter conformance - codex", () => {
	it("spawns codex app-server in the launch-prepared workspace", async () => {
		const { rpc } = await launchCodexConformance();
		expect(connectJsonRpc).toHaveBeenLastCalledWith(
			"codex",
			["app-server"],
			CONFORMANCE_WORKSPACE
		);
		expect(requestParams(rpc, "thread/start")).toMatchObject({
			cwd: CONFORMANCE_WORKSPACE,
		});
	});

	it("receives the identical unexpanded context — `/refs` stay verbatim", async () => {
		const { rpc, startContext } = await launchCodexConformance();
		const text = textBlockOf(requestParams(rpc, "turn/start"), "input");
		expect(text).toBe(startContext);
		expect(text).toContain(CORE_DESCRIPTION);
		expect(text).toContain(SKILL_SENTENCE);
		expect(text).not.toContain(ALPHA_BODY);
		expect(text).not.toContain(BETA_BODY);
	});
});

describe("adapter conformance - opencode", () => {
	it("spawns opencode acp in the workspace and binds the session to it", async () => {
		const { rpc } = await launchOpencodeConformance();
		expect(connectJsonRpc).toHaveBeenLastCalledWith(
			"opencode",
			["acp"],
			CONFORMANCE_WORKSPACE
		);
		expect(requestParams(rpc, "session/new")).toMatchObject({
			cwd: CONFORMANCE_WORKSPACE,
		});
	});

	it("receives the identical unexpanded context — `/refs` stay verbatim", async () => {
		const { rpc, startContext } = await launchOpencodeConformance();
		const text = textBlockOf(requestParams(rpc, "session/prompt"), "prompt");
		expect(text).toBe(startContext);
		expect(text).toContain(CORE_DESCRIPTION);
		expect(text).toContain(SKILL_SENTENCE);
		expect(text).not.toContain(ALPHA_BODY);
		expect(text).not.toContain(BETA_BODY);
	});
});

describe("adapter conformance - pi", () => {
	it("spawns pi --mode rpc in the launch-prepared workspace", async () => {
		await launchPiConformance();
		expect(spawnProcessIo).toHaveBeenLastCalledWith(
			"pi",
			["--mode", "rpc"],
			CONFORMANCE_WORKSPACE
		);
	});

	it("receives the identical unexpanded context — `/refs` stay verbatim", async () => {
		const { io, startContext } = await launchPiConformance();
		const text = piPromptText(io);
		expect(text).toBe(startContext);
		expect(text).toContain(CORE_DESCRIPTION);
		expect(text).toContain(SKILL_SENTENCE);
		expect(text).not.toContain(ALPHA_BODY);
		expect(text).not.toContain(BETA_BODY);
	});
});
