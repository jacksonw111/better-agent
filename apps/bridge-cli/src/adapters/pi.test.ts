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

describe("piAdapter - process lifecycle", () => {
	it("pushes an agent_exited status, then closes `events`, once the process exits on its own", async () => {
		const { io, triggerExit } = createFakeProcessIo();
		vi.mocked(spawnProcessIo).mockResolvedValue(io);

		const handle = await piAdapter.start("/tmp/project");
		const iterator = handle.events[Symbol.asyncIterator]();

		triggerExit({ code: 1, signal: null });

		const { value: statusEvent } = await iterator.next();
		expect(statusEvent).toEqual({
			kind: "status",
			status: "agent_exited",
			turnEpoch: 0,
		});

		const result = await iterator.next();
		expect(result.done).toBe(true);
	});

	it("spawns `pi --mode rpc` in the given directory", async () => {
		const { io } = createFakeProcessIo();
		vi.mocked(spawnProcessIo).mockResolvedValue(io);

		await piAdapter.start("/tmp/project");

		expect(spawnProcessIo).toHaveBeenLastCalledWith(
			"pi",
			["--mode", "rpc"],
			"/tmp/project"
		);
	});
});

describe("piAdapter - send()", () => {
	it("writes a prompt command frame to stdin", async () => {
		const { io } = createFakeProcessIo();
		vi.mocked(spawnProcessIo).mockResolvedValue(io);

		const handle = await piAdapter.start("/tmp/project");
		handle.send("hello");

		expect(io.writeLine).toHaveBeenCalledWith(
			JSON.stringify({ type: "prompt", message: "hello" })
		);
	});

	it("stamps each turn's events with a bumped turnEpoch (RC-T3)", async () => {
		const { io } = createFakeProcessIo();
		vi.mocked(spawnProcessIo).mockResolvedValue(io);

		const handle = await piAdapter.start("/tmp/project");
		const iterator = handle.events[Symbol.asyncIterator]();

		handle.send("first turn");
		expect((await iterator.next()).value).toMatchObject({ turnEpoch: 1 });

		handle.interrupt?.();
		handle.send("second turn");
		expect((await iterator.next()).value).toMatchObject({ turnEpoch: 3 });
	});
});

describe("piAdapter - interrupt", () => {
	// T0: the web Stop button relays `interrupt()` — before this, pi's
	// AgentHandle had no `interrupt` at all despite agent-capabilities.ts
	// advertising `interrupt: true`, so Stop silently did nothing even though
	// pi's own protocol supports an abort frame.
	it("writes an abort command frame to stdin", async () => {
		const { io } = createFakeProcessIo();
		vi.mocked(spawnProcessIo).mockResolvedValue(io);

		const handle = await piAdapter.start("/tmp/project");
		handle.interrupt?.();

		expect(io.writeLine).toHaveBeenCalledWith(
			JSON.stringify({ type: "abort" })
		);
	});
});

describe("piAdapter - session_ready", () => {
	it("sends get_state and get_commands once, right at start", async () => {
		const { io } = createFakeProcessIo();
		vi.mocked(spawnProcessIo).mockResolvedValue(io);

		await piAdapter.start("/tmp/project");

		expect(io.writeLine).toHaveBeenCalledWith(
			JSON.stringify({ type: "get_state" })
		);
		expect(io.writeLine).toHaveBeenCalledWith(
			JSON.stringify({ type: "get_available_models" })
		);
		expect(io.writeLine).toHaveBeenCalledWith(
			JSON.stringify({ type: "get_commands" })
		);
	});
});

describe("piAdapter - session_ready response parsing", () => {
	it("emits a session_ready event with slashCommands/skills once the get_commands response arrives", async () => {
		const { io, pushLine } = createFakeProcessIo();
		vi.mocked(spawnProcessIo).mockResolvedValue(io);

		const handle = await piAdapter.start("/tmp/project");
		const iterator = handle.events[Symbol.asyncIterator]();

		pushLine(
			JSON.stringify({
				type: "response",
				command: "get_commands",
				success: true,
				data: {
					commands: [
						{ name: "fix-tests", source: "prompt" },
						{ name: "skill:brave-search", source: "skill" },
					],
				},
			})
		);

		const { value: event } = await iterator.next();
		expect(event).toEqual({
			kind: "status",
			status: "session_ready",
			detail: {
				model: undefined,
				slashCommands: ["fix-tests", "skill:brave-search"],
				skills: ["brave-search"],
			},
			turnEpoch: 0,
		});
	});
});

describe("piAdapter - session_ready model merge", () => {
	it("includes the model when get_state's response arrives before get_commands'", async () => {
		const { io, pushLine } = createFakeProcessIo();
		vi.mocked(spawnProcessIo).mockResolvedValue(io);

		const handle = await piAdapter.start("/tmp/project");
		const iterator = handle.events[Symbol.asyncIterator]();

		pushLine(
			JSON.stringify({
				type: "response",
				command: "get_state",
				success: true,
				data: { model: { id: "claude-sonnet-4-20250514" } },
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
				model: "claude-sonnet-4-20250514",
				slashCommands: [],
				skills: [],
			},
			turnEpoch: 0,
		});
	});
});

// pi's getStatus timeout behavior (makePiStatusTracker's timeout fallback) is
// covered in pi-get-status.test.ts, split out purely to keep this file under
// the repo's 300-line limit.

describe("piAdapter - session_ready emitted only once", () => {
	it("never emits a second session_ready even if get_commands responds twice", async () => {
		const { io, pushLine } = createFakeProcessIo();
		vi.mocked(spawnProcessIo).mockResolvedValue(io);

		const handle = await piAdapter.start("/tmp/project");
		const iterator = handle.events[Symbol.asyncIterator]();

		const commandsResponse = JSON.stringify({
			type: "response",
			command: "get_commands",
			success: true,
			data: { commands: [] },
		});
		pushLine(commandsResponse);
		await iterator.next();

		pushLine(commandsResponse);
		pushLine(
			JSON.stringify({
				type: "message_end",
				message: { role: "assistant", content: "after the second response" },
			})
		);

		const { value: nextEvent } = await iterator.next();
		expect(nextEvent).toEqual({
			kind: "message",
			role: "assistant",
			text: "after the second response",
			turnEpoch: 0,
		});
	});
});
