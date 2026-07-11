// R2-T3 item 1 (CRITICAL): send()'s streamingBehavior wiring, split out of
// pi.test.ts purely to keep that file under the repo's 300-line limit.

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

describe("piAdapter - send() streamingBehavior", () => {
	// CRITICAL (R2-T3 item 1): pi errors on a bare prompt sent while it's still
	// mid-turn — send() must carry streamingBehavior: "followUp" once an
	// agent_start line has been seen, and only revert to a bare prompt after
	// the true idle signal (agent_settled, R2-T3 item 3).
	it("carries streamingBehavior: followUp once pi has started streaming", async () => {
		const { io, pushLine } = createFakeProcessIo();
		vi.mocked(spawnProcessIo).mockResolvedValue(io);

		const handle = await piAdapter.start("/tmp/project");
		pushLine(JSON.stringify({ type: "agent_start" }));
		await new Promise((resolve) => setImmediate(resolve));

		handle.send("steer this");

		expect(io.writeLine).toHaveBeenCalledWith(
			JSON.stringify({
				type: "prompt",
				message: "steer this",
				streamingBehavior: "followUp",
			})
		);
	});

	it("reverts to a bare prompt once agent_settled fires, even after agent_end", async () => {
		const { io, pushLine } = createFakeProcessIo();
		vi.mocked(spawnProcessIo).mockResolvedValue(io);

		const handle = await piAdapter.start("/tmp/project");
		pushLine(JSON.stringify({ type: "agent_start" }));
		pushLine(JSON.stringify({ type: "agent_end" }));
		await new Promise((resolve) => setImmediate(resolve));

		// agent_end is NOT the idle signal (auto-retries can follow) — still
		// mid-turn here.
		handle.send("still mid-turn");
		expect(io.writeLine).toHaveBeenCalledWith(
			JSON.stringify({
				type: "prompt",
				message: "still mid-turn",
				streamingBehavior: "followUp",
			})
		);

		pushLine(JSON.stringify({ type: "agent_settled" }));
		await new Promise((resolve) => setImmediate(resolve));

		handle.send("idle again");
		expect(io.writeLine).toHaveBeenCalledWith(
			JSON.stringify({ type: "prompt", message: "idle again" })
		);
	});
});
