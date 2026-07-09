// piAdapter's extension_ui_request handling (pi-approvals.ts) — split out of
// pi.test.ts purely to keep that file under the repo's 300-line limit, the
// same way pi.runtime.test.ts/pi-get-status.test.ts already split off other
// pi.ts specs. Duplicates `createFakeProcessIo` for the same reason those
// other files do: `vi.mock` hoisting is per-spec-file.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APPROVAL_TIMEOUT_MS } from "./approvals";
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

describe("piAdapter - extension_ui_request auto-cancel (RC-T4)", () => {
	it("auto-cancels an input request immediately: writes extension_ui_response cancelled and surfaces a status event", async () => {
		const { io, pushLine } = createFakeProcessIo();
		vi.mocked(spawnProcessIo).mockResolvedValue(io);

		const handle = await piAdapter.start("/tmp/project");
		const iterator = handle.events[Symbol.asyncIterator]();

		pushLine(
			JSON.stringify({
				type: "extension_ui_request",
				id: "req-1",
				method: "input",
				title: "Enter a value",
			})
		);

		const { value: event } = await iterator.next();
		expect(event).toMatchObject({
			kind: "status",
			status: "extension_ui_auto_cancelled",
			detail: { method: "input", requestId: "req-1" },
		});
		expect(io.writeLine).toHaveBeenCalledWith(
			JSON.stringify({
				type: "extension_ui_response",
				id: "req-1",
				cancelled: true,
			})
		);
	});
});

describe("piAdapter - extension_ui_request select presents a card (RC-T4)", () => {
	it("surfaces a select request as an approval card, and answering it writes the picked value back on stdin", async () => {
		const { io, pushLine } = createFakeProcessIo();
		vi.mocked(spawnProcessIo).mockResolvedValue(io);

		const handle = await piAdapter.start("/tmp/project");
		const iterator = handle.events[Symbol.asyncIterator]();

		pushLine(
			JSON.stringify({
				type: "extension_ui_request",
				id: "req-2",
				method: "select",
				title: "Allow dangerous command?",
				options: ["Allow", "Block"],
			})
		);

		const { value: card } = await iterator.next();
		expect(card).toMatchObject({
			kind: "approval",
			requestId: "req-2",
			options: [
				{ id: "Allow", label: "Allow" },
				{ id: "Block", label: "Block" },
			],
		});

		handle.answerApproval("req-2", "Allow");
		expect(io.writeLine).toHaveBeenCalledWith(
			JSON.stringify({
				type: "extension_ui_response",
				id: "req-2",
				value: "Allow",
			})
		);
	});
});

describe("piAdapter - extension_ui_request never hangs forever (RC-T4)", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("an unanswered confirm request resolves cancelled via the shared timeout", async () => {
		const { io, pushLine } = createFakeProcessIo();
		vi.mocked(spawnProcessIo).mockResolvedValue(io);

		const handle = await piAdapter.start("/tmp/project");
		const iterator = handle.events[Symbol.asyncIterator]();

		pushLine(
			JSON.stringify({
				type: "extension_ui_request",
				id: "req-3",
				method: "confirm",
				title: "Clear session?",
			})
		);
		await iterator.next(); // the approval card

		await vi.advanceTimersByTimeAsync(APPROVAL_TIMEOUT_MS);

		expect(io.writeLine).toHaveBeenCalledWith(
			JSON.stringify({
				type: "extension_ui_response",
				id: "req-3",
				cancelled: true,
			})
		);
		const { value: timeoutEvent } = await iterator.next();
		expect(timeoutEvent).toMatchObject({
			kind: "approval",
			cancelled: true,
			requestId: "req-3",
			title: "Timed out — declined",
		});
	});
});
