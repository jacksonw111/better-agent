import { describe, expect, it, vi } from "vitest";
import { createAsyncQueue } from "./async-queue";
import { piAdapter } from "./pi";
import type { ProcessExitInfo, ProcessIo } from "./process-io";
import { spawnProcessIo } from "./process-io";

vi.mock("./process-io", () => ({ spawnProcessIo: vi.fn() }));

/** An async iterable that never yields — stands in for stdout/stderr on a
 * process that's still running. */
const neverEndingLines: AsyncIterable<string> = {
	[Symbol.asyncIterator]() {
		return {
			next: () => new Promise<IteratorResult<string>>(() => undefined),
		};
	},
};

/** A fake `ProcessIo` whose exit can be triggered, and whose stdout lines can
 * be fed, on demand by the test, standing in for the real `pi --mode rpc`
 * child process pi.ts spawns. */
function createFakeProcessIo(): {
	io: ProcessIo;
	pushLine(line: string): void;
	triggerExit(info: ProcessExitInfo): void;
} {
	const exitHandlers: Array<(info: ProcessExitInfo) => void> = [];
	const lines = createAsyncQueue<string>();
	return {
		io: {
			child: {} as ProcessIo["child"],
			lines,
			onExit: (handler) => exitHandlers.push(handler),
			stderrLines: neverEndingLines,
			stop: vi.fn(),
			writeLine: vi.fn(),
		},
		pushLine(line: string): void {
			lines.push(line);
		},
		triggerExit(info: ProcessExitInfo): void {
			for (const handler of exitHandlers) {
				handler(info);
			}
		},
	};
}

describe("piAdapter - stdout/stderr relay", () => {
	it("relays parsed stdout lines as normalized events", async () => {
		const { io, pushLine } = createFakeProcessIo();
		vi.mocked(spawnProcessIo).mockResolvedValue(io);

		const handle = await piAdapter.start("/tmp/project");
		const iterator = handle.events[Symbol.asyncIterator]();

		pushLine(
			JSON.stringify({
				type: "message_update",
				assistantMessageEvent: { type: "text_delta", delta: "hi" },
			})
		);

		const { value: event } = await iterator.next();
		expect(event).toEqual({ kind: "output", text: "hi", turnEpoch: 0 });
	});

	it("relays stderr lines as error events", async () => {
		const io: ProcessIo = {
			child: {} as ProcessIo["child"],
			lines: createAsyncQueue<string>(),
			onExit: vi.fn(),
			stderrLines: (() => {
				const queue = createAsyncQueue<string>();
				queue.push("pi: something went wrong");
				return queue;
			})(),
			stop: vi.fn(),
			writeLine: vi.fn(),
		};
		vi.mocked(spawnProcessIo).mockResolvedValue(io);

		const handle = await piAdapter.start("/tmp/project");
		const { value: event } = await handle.events[Symbol.asyncIterator]().next();
		expect(event).toEqual({
			kind: "error",
			message: "pi: something went wrong",
			turnEpoch: 0,
		});
	});
});

describe("piAdapter - answerApproval has no protocol to wire into", () => {
	it("always emits a status warning: pi has no approval requests to answer", async () => {
		const { io } = createFakeProcessIo();
		vi.mocked(spawnProcessIo).mockResolvedValue(io);
		const handle = await piAdapter.start("/tmp/project");
		// `start` itself writes the get_state/get_commands frames — reset here so
		// the assertion below only covers writes caused by `answerApproval`.
		vi.mocked(io.writeLine).mockClear();

		handle.answerApproval("anything", "allow");

		const { value: event } = await handle.events[Symbol.asyncIterator]().next();
		expect(event).toEqual({
			detail: { requestId: "anything" },
			kind: "status",
			status: "approval_unknown",
			turnEpoch: 0,
		});
		expect(io.writeLine).not.toHaveBeenCalled();
	});
});

describe("piAdapter - stop()", () => {
	it("stops the process and closes `events`", async () => {
		const { io } = createFakeProcessIo();
		vi.mocked(spawnProcessIo).mockResolvedValue(io);
		const handle = await piAdapter.start("/tmp/project");

		handle.stop();

		expect(io.stop).toHaveBeenCalledTimes(1);
		const result = await handle.events[Symbol.asyncIterator]().next();
		expect(result.done).toBe(true);
	});
});

describe("piAdapter - setModel()", () => {
	it("writes a set_model frame with separate provider + modelId (provider/id form)", async () => {
		const { io } = createFakeProcessIo();
		vi.mocked(spawnProcessIo).mockResolvedValue(io);
		const handle = await piAdapter.start("/tmp/project");

		// A `provider/id` string resolves directly, no model list needed.
		handle.setModel?.("anthropic/claude-sonnet-4-20250514");

		expect(io.writeLine).toHaveBeenCalledWith(
			JSON.stringify({
				type: "set_model",
				provider: "anthropic",
				modelId: "claude-sonnet-4-20250514",
			})
		);
	});

	it("resolves the provider from get_available_models for a bare model id", async () => {
		const { io, pushLine } = createFakeProcessIo();
		vi.mocked(spawnProcessIo).mockResolvedValue(io);
		const handle = await piAdapter.start("/tmp/project");

		pushLine(
			JSON.stringify({
				type: "response",
				command: "get_available_models",
				success: true,
				data: { models: [{ id: "gpt-5", provider: "openai" }] },
			})
		);
		// Let the stdout line loop process the frame into the provider map.
		await new Promise((resolve) => setImmediate(resolve));

		handle.setModel?.("gpt-5");

		expect(io.writeLine).toHaveBeenCalledWith(
			JSON.stringify({
				type: "set_model",
				provider: "openai",
				modelId: "gpt-5",
			})
		);
	});
});

describe("piAdapter - setThinking()", () => {
	it("writes a set_thinking_level frame for a valid level", async () => {
		const { io } = createFakeProcessIo();
		vi.mocked(spawnProcessIo).mockResolvedValue(io);
		const handle = await piAdapter.start("/tmp/project");

		handle.setThinking?.("high");

		expect(io.writeLine).toHaveBeenCalledWith(
			JSON.stringify({ type: "set_thinking_level", level: "high" })
		);
	});

	it("emits an error event instead of writing a frame for an unrecognized level", async () => {
		const { io } = createFakeProcessIo();
		vi.mocked(spawnProcessIo).mockResolvedValue(io);
		const handle = await piAdapter.start("/tmp/project");
		vi.mocked(io.writeLine).mockClear();

		handle.setThinking?.("ultra");

		const { value: event } = await handle.events[Symbol.asyncIterator]().next();
		expect(event).toEqual({
			kind: "error",
			message: 'pi setThinking: unknown thinking level "ultra"',
			turnEpoch: 0,
		});
		expect(io.writeLine).not.toHaveBeenCalled();
	});
});

describe("piAdapter - session_ready models merge", () => {
	it("includes the available model list when get_available_models responds before get_commands'", async () => {
		const { io, pushLine } = createFakeProcessIo();
		vi.mocked(spawnProcessIo).mockResolvedValue(io);

		const handle = await piAdapter.start("/tmp/project");
		const iterator = handle.events[Symbol.asyncIterator]();

		pushLine(
			JSON.stringify({
				type: "response",
				command: "get_available_models",
				success: true,
				data: {
					models: [{ id: "claude-sonnet-4-20250514" }, { id: "gpt-5" }],
				},
			})
		);
		pushLine(
			JSON.stringify({
				type: "response",
				command: "get_commands",
				success: true,
				data: { commands: [] },
			})
		);

		const { value: event } = await iterator.next();
		expect(event).toEqual({
			kind: "status",
			status: "session_ready",
			detail: {
				models: ["claude-sonnet-4-20250514", "gpt-5"],
				slashCommands: [],
				skills: [],
			},
			turnEpoch: 0,
		});
	});
});
