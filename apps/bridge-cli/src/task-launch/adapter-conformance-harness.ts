import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ManagedToolInventoryItem } from "@better-agent/agent/computer-ports";
import { vi } from "vitest";
import { selectAdapter } from "../adapters";
import { createAsyncQueue } from "../adapters/async-queue";
import {
	mockQuery,
	type QueryHarness,
} from "../adapters/claude-code-test-harness";
import { connectJsonRpc, type JsonRpcIo } from "../adapters/jsonrpc-io";
import { createFakeRpc } from "../adapters/opencode-test-harness";
import { type ProcessIo, spawnProcessIo } from "../adapters/process-io";
import type { AgentHandle, AgentKind } from "../adapters/types";
import { isRecord } from "../normalize/types";
import type { RelayTransport } from "../relay-client";
import { createRunSessionSupplier } from "./run-session";
import {
	type SkillReferenceDeps,
	skillResolverForAgent,
} from "./skill-references";
import { buildTaskStartContext } from "./start-context";

// S4-T4 (master spec §19.4): shared plumbing for the runtime-adapter
// conformance suite — ONE Task Start Context input driven through every
// adapter's REAL start path (run-session's supplier + the real selectAdapter),
// with only the process/SDK wire faked, reusing the existing per-adapter
// harnesses. Not a `*.test.*` file, so vitest's include glob skips it; each
// importing test file still declares its own vi.mock for
// `@anthropic-ai/claude-agent-sdk`, `../adapters/jsonrpc-io` and
// `../adapters/process-io`.

export const CONFORMANCE_WORKSPACE = "/ws/conformance/run-1";
/** The Description's core segment — must reach every runtime verbatim. */
export const CORE_DESCRIPTION = "Fix the flaky login test in CI.";
/** Two Skill References (§6.6) after the core segment. */
export const TASK_DESCRIPTION = `${CORE_DESCRIPTION}\n\nApply /alpha and /beta before starting.`;
export const ALPHA_BODY = "Alpha skill body: reproduce the failure first.";
export const BETA_BODY = "Beta skill body: bisect the flake with git.";

const TOOL_INVENTORY: ManagedToolInventoryItem[] = [
	{ installed: true, name: "git" },
	{ installed: true, name: "gh" },
];

function skillFile(name: string, body: string): string {
	return `---\nname: ${name}\ndescription: "d"\n---\n\n${body}\n`;
}

/** Two installed local skills, in-memory (D6's injectable discovery). */
const SKILL_DEPS: SkillReferenceDeps = {
	readDirNames: () => Promise.resolve(["alpha", "beta"]),
	readTextFile: (path) =>
		Promise.resolve(
			path.includes("alpha")
				? skillFile("alpha", ALPHA_BODY)
				: skillFile("beta", BETA_BODY)
		),
	skillsDir: "/fake/.claude/skills",
};

/** The SAME §10.2 assembly launch-wiring's `buildStartContext` drives, with
 * in-memory skill discovery — per-runtime output differs ONLY through the
 * production `skillResolverForAgent` seam. */
export function conformanceStartContext(agentKind: AgentKind): Promise<string> {
	return buildTaskStartContext(
		{
			description: TASK_DESCRIPTION,
			issueSnapshots: [],
			toolInventory: TOOL_INVENTORY,
			workspacePath: CONFORMANCE_WORKSPACE,
		},
		{ resolveSkillReferences: skillResolverForAgent(agentKind, SKILL_DEPS) }
	);
}

function fakeTransport(): RelayTransport {
	return {
		fetchConfig: vi.fn(),
		pollCommands: vi.fn(() => Promise.resolve([])),
		pushEvents: vi.fn(() => Promise.resolve()),
		startSession: vi.fn(() =>
			Promise.resolve({
				config: null,
				mcpServers: [],
				sessionId: "sess-1",
				skills: [],
			})
		),
	};
}

export interface ConformanceRun {
	handle: AgentHandle;
	startContext: string;
}

/** Builds the run's start context, then drives the REAL launch session path
 * (run-session's supplier with the real `selectAdapter`) for `agentKind`. */
export async function launchConformanceRun(
	agentKind: AgentKind
): Promise<ConformanceRun> {
	const startContext = await conformanceStartContext(agentKind);
	let handle: AgentHandle | undefined;
	const supplier = createRunSessionSupplier(
		{ serverUrl: "https://server.example" },
		{
			createTransport: () => fakeTransport(),
			runLoop: () => Promise.resolve(),
			selectAdapter: (kind) => {
				const adapter = selectAdapter(kind);
				return {
					start: async (dir, opts) => {
						handle = await adapter.start(dir, opts);
						return handle;
					},
				};
			},
		}
	);
	await supplier({
		agentKind,
		runId: "9a1f0e00-bbbb-4000-8000-000000000002",
		sessionCredential: "bt_secret",
		signal: new AbortController().signal,
		startContext,
		taskId: "5b2c1d00-aaaa-4000-8000-000000000001",
		workspacePath: CONFORMANCE_WORKSPACE,
	});
	if (!handle) {
		throw new Error("adapter.start was never called");
	}
	return { handle, startContext };
}

// --- per-adapter wire fakes + launch helpers --------------------------------

export async function launchClaudeConformance(): Promise<
	ConformanceRun & { harness: QueryHarness }
> {
	const { harness } = mockQuery();
	const run = await launchConformanceRun("claude-code");
	return { ...run, harness };
}

export async function launchCodexConformance(): Promise<
	ConformanceRun & { rpc: JsonRpcIo }
> {
	const fake = createFakeRpc();
	vi.mocked(fake.rpc.request).mockImplementation((method: string) =>
		method === "thread/start"
			? Promise.resolve({ thread: { id: "thread_1" } })
			: Promise.resolve({})
	);
	vi.mocked(connectJsonRpc).mockResolvedValue(fake.rpc);
	const run = await launchConformanceRun("codex");
	return { ...run, rpc: fake.rpc };
}

export async function launchOpencodeConformance(): Promise<
	ConformanceRun & { rpc: JsonRpcIo }
> {
	const fake = createFakeRpc();
	vi.mocked(connectJsonRpc).mockResolvedValue(fake.rpc);
	const run = await launchConformanceRun("opencode");
	return { ...run, rpc: fake.rpc };
}

/** A fake `ProcessIo` standing in for `pi --mode rpc` (mirrors pi.test.ts's
 * fake): stdout lines can be fed on demand, stdin writes are captured. */
export function fakePiProcessIo(): {
	io: ProcessIo;
	pushLine(l: string): void;
} {
	const lines = createAsyncQueue<string>();
	const stderrLines = createAsyncQueue<string>();
	return {
		io: {
			child: {} as ProcessIo["child"],
			lines,
			onExit: () => undefined,
			stderrLines,
			stop: vi.fn(),
			writeLine: vi.fn(),
		},
		pushLine: (line: string) => lines.push(line),
	};
}

export async function launchPiConformance(): Promise<
	ConformanceRun & { io: ProcessIo; pushLine(l: string): void }
> {
	const fake = fakePiProcessIo();
	vi.mocked(spawnProcessIo).mockResolvedValue(fake.io);
	const run = await launchConformanceRun("pi");
	return { ...run, io: fake.io, pushLine: fake.pushLine };
}

// --- first-wire-input extraction ---------------------------------------------

/** The text of the first SDK user turn the claude-code adapter streamed. */
export async function claudeFirstTurnText(
	prompt: AsyncIterable<SDKUserMessage>
): Promise<string | undefined> {
	const { value } = await prompt[Symbol.asyncIterator]().next();
	const content: unknown = value?.message.content;
	return typeof content === "string" ? content : undefined;
}

/** Params of the first `method` call on a fake rpc, or undefined. */
export function requestParams(rpc: JsonRpcIo, method: string): unknown {
	const call = vi
		.mocked(rpc.request)
		.mock.calls.find(([calledMethod]) => calledMethod === method);
	return call?.[1];
}

/** The `text` of the single text block in codex's `turn/start` `input` /
 * opencode's `session/prompt` `prompt` params. */
export function textBlockOf(
	params: unknown,
	field: "input" | "prompt"
): string | undefined {
	const blocks =
		isRecord(params) && Array.isArray(params[field])
			? (params[field] as unknown[])
			: [];
	const [first] = blocks;
	return isRecord(first) && typeof first.text === "string"
		? first.text
		: undefined;
}

/** The `message` of the first `prompt` frame pi's stdin received. */
export function piPromptText(io: ProcessIo): string | undefined {
	const frames = vi
		.mocked(io.writeLine)
		.mock.calls.map(([line]) => JSON.parse(line) as unknown);
	const prompt = frames.find(
		(frame) => isRecord(frame) && frame.type === "prompt"
	);
	return isRecord(prompt) && typeof prompt.message === "string"
		? prompt.message
		: undefined;
}

/** Reads `handle.events` until a status event with `status` arrives. */
export async function nextStatusDetail(
	handle: AgentHandle,
	status: string
): Promise<Record<string, unknown>> {
	for await (const event of handle.events) {
		if (event.kind === "status" && event.status === status) {
			return isRecord(event.detail) ? event.detail : {};
		}
	}
	throw new Error(`no ${status} event arrived`);
}
