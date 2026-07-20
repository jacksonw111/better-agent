import {
	type CanUseTool,
	query,
	type SDKUserMessage,
	type SlashCommand,
} from "@anthropic-ai/claude-agent-sdk";
import { vi } from "vitest";
import type { NormalizedEvent } from "../normalize/types";
import { createAsyncQueue } from "./async-queue";

// Shared `query()` mock for the claude-code adapter tests, split out of
// claude-code.test.ts to keep that file under the repo's max-lines-per-file
// gate. Not a `*.test.*` file, so vitest's include glob skips it; each
// importing test file still declares its own `vi.mock("@anthropic-ai/...")`.

export interface QueryHarness {
	canUseTool: CanUseTool;
	endOutput(): void;
	/** Rejects by default (like the other control methods, a test that cares
	 * overrides it) — getStatus must ship a snapshot even when this fails. */
	getContextUsage: ReturnType<typeof vi.fn>;
	interrupt: ReturnType<typeof vi.fn>;
	mcpServerStatus: ReturnType<typeof vi.fn>;
	/** The full `options` object passed to `query()` — lets a test assert on
	 * startup config (systemPrompt preset+append, maxTurns, …). */
	options: Record<string, unknown> | undefined;
	prompt: AsyncIterable<SDKUserMessage>;
	reloadSkills: ReturnType<typeof vi.fn>;
	setMcpServers: ReturnType<typeof vi.fn>;
	setModel: ReturnType<typeof vi.fn>;
	setPermissionMode: ReturnType<typeof vi.fn>;
	supportedCommands: ReturnType<typeof vi.fn>;
	supportedModels: ReturnType<typeof vi.fn>;
	/** Feed an SDK message to the query's output stream. */
	yieldMessage(message: unknown): void;
}

/** The vi.fn() control surface shared between `harness.*` (what a test
 * asserts/overrides) and the mock `iterable` `query()` returns (what the
 * adapter actually calls) — split out of `mockQuery` purely to keep that
 * function under the repo's max-lines-per-function gate. */
type QueryControls = Pick<
	QueryHarness,
	| "interrupt"
	| "setModel"
	| "setMcpServers"
	| "reloadSkills"
	| "setPermissionMode"
	| "supportedModels"
	| "supportedCommands"
	| "getContextUsage"
	| "mcpServerStatus"
>;

function makeQueryControls(
	models: Array<{ resolvedModel?: string; value: string }>,
	commands: SlashCommand[]
): QueryControls {
	return {
		interrupt: vi.fn(() => Promise.resolve()),
		setModel: vi.fn(() => Promise.resolve()),
		setMcpServers: vi.fn(() =>
			Promise.resolve({ added: [], failed: [], removed: [] })
		),
		reloadSkills: vi.fn(() => Promise.resolve({ commands: [] })),
		setPermissionMode: vi.fn(() => Promise.resolve()),
		supportedModels: vi.fn(() => Promise.resolve(models)),
		supportedCommands: vi.fn(() => Promise.resolve(commands)),
		getContextUsage: vi.fn(() =>
			Promise.reject(new Error("getContextUsage not mocked"))
		),
		mcpServerStatus: vi.fn(() =>
			Promise.reject(new Error("mcpServerStatus not mocked"))
		),
	};
}

/** Mocks `query()` so a test controls what the SDK yields and can capture the
 * streaming prompt + canUseTool the adapter wires up. `supportedModels`/
 * `supportedCommands` default to the given (empty) lists — a test that cares
 * passes its own. */
export function mockQuery(
	models: Array<{ resolvedModel?: string; value: string }> = [],
	commands: SlashCommand[] = []
): {
	harness: QueryHarness;
} {
	const output = createAsyncQueue<unknown>();
	const controls = makeQueryControls(models, commands);
	const harness = {} as QueryHarness;
	// Controls exist BEFORE the adapter starts, so a test can re-mock e.g.
	// `supportedModels` ahead of `start()` (the startup session_ready fetches
	// it during start — see claude-code-startup-ready.ts).
	Object.assign(harness, controls);
	vi.mocked(query).mockImplementation((params) => {
		harness.prompt = params.prompt as AsyncIterable<SDKUserMessage>;
		harness.canUseTool = params.options?.canUseTool as CanUseTool;
		harness.options = params.options as Record<string, unknown> | undefined;
		harness.yieldMessage = (message: unknown) => output.push(message);
		harness.endOutput = () => output.close();
		Object.assign(harness, controls);
		const iterable = {
			[Symbol.asyncIterator]: () => output[Symbol.asyncIterator](),
			...controls,
		};
		// The adapter only touches the async-iterable + interrupt/setModel/
		// setPermissionMode/supportedModels/supportedCommands; the rest of the
		// real Query surface is irrelevant to these tests.
		return iterable as unknown as ReturnType<typeof query>;
	});
	return { harness };
}

export async function nextEvent(
	iterator: AsyncIterator<NormalizedEvent>
): Promise<NormalizedEvent | undefined> {
	const { value, done } = await iterator.next();
	return done ? undefined : value;
}

/** Consumes (and sanity-checks) the startup `session_ready` that `start()`
 * emits as the feed's first event (see claude-code-startup-ready.ts) — for
 * tests that assert on what comes AFTER it. */
export async function skipStartupReady(
	iterator: AsyncIterator<NormalizedEvent>
): Promise<void> {
	const event = await nextEvent(iterator);
	if (event?.kind !== "status" || event.status !== "session_ready") {
		throw new Error(
			`expected the startup session_ready first, got ${JSON.stringify(event)}`
		);
	}
}
