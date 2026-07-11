// R3-T1: pi's `sendWith` (queue/steer/interrupt) — split out of pi.test.ts
// purely to keep that file under the repo's 300-line limit, the same way
// pi-send-streaming.test.ts already split off `send()`'s own streamingBehavior
// coverage. Duplicates `createFakeProcessIo` for the same reason those other
// pi.ts spec files do: `vi.mock` hoisting is per-spec-file.

import { describe, expect, it, vi } from "vitest";
import { createAsyncQueue } from "./async-queue";
import { piAdapter } from "./pi";
import type { ProcessIo } from "./process-io";
import { spawnProcessIo } from "./process-io";

vi.mock("./process-io", () => ({ spawnProcessIo: vi.fn() }));

const neverEndingLines: AsyncIterable<string> = {
	[Symbol.asyncIterator]() {
		return {
			next: () => new Promise<IteratorResult<string>>(() => undefined),
		};
	},
};

function createFakeProcessIo(): {
	io: ProcessIo;
	pushLine(line: string): void;
} {
	const lines = createAsyncQueue<string>();
	return {
		io: {
			child: {} as ProcessIo["child"],
			lines,
			onExit: () => undefined,
			stderrLines: neverEndingLines,
			stop: vi.fn(),
			writeLine: vi.fn(),
		},
		pushLine(line: string): void {
			lines.push(line);
		},
	};
}

describe("piAdapter - sendWith 'steer'", () => {
	it("writes a prompt with streamingBehavior: steer, without aborting first", async () => {
		const { io, pushLine } = createFakeProcessIo();
		vi.mocked(spawnProcessIo).mockResolvedValue(io);

		const handle = await piAdapter.start("/tmp/project");
		pushLine(JSON.stringify({ type: "agent_start" }));
		await new Promise((resolve) => setImmediate(resolve));

		handle.sendWith?.("redirect this", "steer");

		expect(io.writeLine).toHaveBeenCalledWith(
			JSON.stringify({
				type: "prompt",
				message: "redirect this",
				streamingBehavior: "steer",
			})
		);
		expect(io.writeLine).not.toHaveBeenCalledWith(
			JSON.stringify({ type: "abort" })
		);
	});

	it("does not reset the streaming tracker — a plain send right after still queues followUp", async () => {
		const { io, pushLine } = createFakeProcessIo();
		vi.mocked(spawnProcessIo).mockResolvedValue(io);

		const handle = await piAdapter.start("/tmp/project");
		pushLine(JSON.stringify({ type: "agent_start" }));
		await new Promise((resolve) => setImmediate(resolve));

		handle.sendWith?.("redirect this", "steer");
		handle.send("still mid-turn");

		expect(io.writeLine).toHaveBeenCalledWith(
			JSON.stringify({
				type: "prompt",
				message: "still mid-turn",
				streamingBehavior: "followUp",
			})
		);
	});
});

describe("piAdapter - sendWith 'interrupt'", () => {
	it("aborts the in-flight turn, then sends a bare (non-followUp) prompt", async () => {
		const { io, pushLine } = createFakeProcessIo();
		vi.mocked(spawnProcessIo).mockResolvedValue(io);

		const handle = await piAdapter.start("/tmp/project");
		pushLine(JSON.stringify({ type: "agent_start" }));
		await new Promise((resolve) => setImmediate(resolve));

		handle.sendWith?.("fresh start", "interrupt");

		const abortIndex = vi
			.mocked(io.writeLine)
			.mock.calls.findIndex(
				([line]) => line === JSON.stringify({ type: "abort" })
			);
		const promptIndex = vi
			.mocked(io.writeLine)
			.mock.calls.findIndex(
				([line]) =>
					line === JSON.stringify({ type: "prompt", message: "fresh start" })
			);
		expect(abortIndex).toBeGreaterThanOrEqual(0);
		expect(promptIndex).toBeGreaterThan(abortIndex);
	});

	it("resets the streaming tracker — a plain send right after is a bare prompt", async () => {
		const { io, pushLine } = createFakeProcessIo();
		vi.mocked(spawnProcessIo).mockResolvedValue(io);

		const handle = await piAdapter.start("/tmp/project");
		pushLine(JSON.stringify({ type: "agent_start" }));
		await new Promise((resolve) => setImmediate(resolve));

		handle.sendWith?.("fresh start", "interrupt");
		handle.send("after interrupt");

		expect(io.writeLine).toHaveBeenCalledWith(
			JSON.stringify({ type: "prompt", message: "after interrupt" })
		);
	});
});

describe("piAdapter - sendWith 'queue'", () => {
	it("behaves exactly like send() — followUp while streaming", async () => {
		const { io, pushLine } = createFakeProcessIo();
		vi.mocked(spawnProcessIo).mockResolvedValue(io);

		const handle = await piAdapter.start("/tmp/project");
		pushLine(JSON.stringify({ type: "agent_start" }));
		await new Promise((resolve) => setImmediate(resolve));

		handle.sendWith?.("queued", "queue");

		expect(io.writeLine).toHaveBeenCalledWith(
			JSON.stringify({
				type: "prompt",
				message: "queued",
				streamingBehavior: "followUp",
			})
		);
	});
});
