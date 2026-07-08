import {
	type CanUseTool,
	query,
	type SDKUserMessage,
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
	setModel: ReturnType<typeof vi.fn>;
	setPermissionMode: ReturnType<typeof vi.fn>;
	supportedModels: ReturnType<typeof vi.fn>;
	/** Feed an SDK message to the query's output stream. */
	yieldMessage(message: unknown): void;
}

/** Mocks `query()` so a test controls what the SDK yields and can capture the
 * streaming prompt + canUseTool the adapter wires up. `supportedModels`
 * defaults to the given (empty) list — a test that cares passes its own. */
export function mockQuery(models: Array<{ value: string }> = []): {
	harness: QueryHarness;
} {
	const output = createAsyncQueue<unknown>();
	const interrupt = vi.fn(() => Promise.resolve());
	const setModel = vi.fn(() => Promise.resolve());
	const setPermissionMode = vi.fn(() => Promise.resolve());
	const supportedModels = vi.fn(() => Promise.resolve(models));
	const getContextUsage = vi.fn(() =>
		Promise.reject(new Error("getContextUsage not mocked"))
	);
	const mcpServerStatus = vi.fn(() =>
		Promise.reject(new Error("mcpServerStatus not mocked"))
	);
	const harness = {} as QueryHarness;
	vi.mocked(query).mockImplementation((params) => {
		harness.prompt = params.prompt as AsyncIterable<SDKUserMessage>;
		harness.canUseTool = params.options?.canUseTool as CanUseTool;
		harness.options = params.options as Record<string, unknown> | undefined;
		harness.yieldMessage = (message: unknown) => output.push(message);
		harness.endOutput = () => output.close();
		harness.interrupt = interrupt;
		harness.setModel = setModel;
		harness.setPermissionMode = setPermissionMode;
		harness.supportedModels = supportedModels;
		harness.getContextUsage = getContextUsage;
		harness.mcpServerStatus = mcpServerStatus;
		const iterable = {
			[Symbol.asyncIterator]: () => output[Symbol.asyncIterator](),
			interrupt,
			setModel,
			setPermissionMode,
			supportedModels,
			getContextUsage,
			mcpServerStatus,
		};
		// The adapter only touches the async-iterable + interrupt/setModel/
		// setPermissionMode/supportedModels; the rest of the real Query surface is
		// irrelevant to these tests.
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
