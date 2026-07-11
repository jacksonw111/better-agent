// R3-1 review finding 1: pi's interrupt()/stop() bumped the turn epoch but
// never retracted pending extension_ui confirm/select cards (the approvals/
// questions registries wired in pi-approvals.ts), so a pending card survived
// into the next turn and a late answer wrote an extension_ui_response for an
// already-aborted request — mirrors codex/opencode's RC-T3 interrupt-retracts
// coverage (codex-approvals.test.ts). Split out of pi-approvals.test.ts
// purely to keep both files (and each test body) under the repo's line-count
// gates. Duplicates `createFakeProcessIo` for the same reason
// pi-approvals.test.ts/pi-send-with.test.ts do: `vi.mock` hoisting is
// per-spec-file.

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

describe("piAdapter - interrupt retracts a pending confirm approval card (R3-1 finding 1)", () => {
	it("retracts a pending confirm approval card, and a late answer no-ops", async () => {
		const { io, pushLine } = createFakeProcessIo();
		vi.mocked(spawnProcessIo).mockResolvedValue(io);

		const handle = await piAdapter.start("/tmp/project");
		const iterator = handle.events[Symbol.asyncIterator]();

		pushLine(
			JSON.stringify({
				type: "extension_ui_request",
				id: "req-confirm",
				method: "confirm",
				title: "Clear session?",
			})
		);
		await iterator.next(); // the approval card

		handle.interrupt?.();

		const { value: approvalRetract } = await iterator.next();
		expect(approvalRetract).toMatchObject({
			kind: "approval",
			cancelled: true,
			requestId: "req-confirm",
			title: "Cancelled",
		});

		vi.mocked(io.writeLine).mockClear();
		handle.answerApproval("req-confirm", "confirm");
		expect(io.writeLine).not.toHaveBeenCalledWith(
			JSON.stringify({
				type: "extension_ui_response",
				id: "req-confirm",
				confirmed: true,
			})
		);
	});
});

describe("piAdapter - interrupt retracts a pending select question card (R3-1 finding 1)", () => {
	it("retracts a pending select question card, and a late answer no-ops", async () => {
		const { io, pushLine } = createFakeProcessIo();
		vi.mocked(spawnProcessIo).mockResolvedValue(io);

		const handle = await piAdapter.start("/tmp/project");
		const iterator = handle.events[Symbol.asyncIterator]();

		pushLine(
			JSON.stringify({
				type: "extension_ui_request",
				id: "req-select",
				method: "select",
				title: "Pick one",
				options: ["A", "B"],
			})
		);
		await iterator.next(); // the question card

		handle.interrupt?.();

		const { value: questionRetract } = await iterator.next();
		expect(questionRetract).toMatchObject({
			kind: "question",
			cancelled: true,
			requestId: "req-select",
			title: "Cancelled",
		});

		vi.mocked(io.writeLine).mockClear();
		handle.answerQuestion?.("req-select", [["A"]]);
		expect(io.writeLine).not.toHaveBeenCalledWith(
			JSON.stringify({
				type: "extension_ui_response",
				id: "req-select",
				value: "A",
			})
		);
	});
});

describe("piAdapter - sendWith('interrupt') retracts pending extension_ui cards (R3-1 finding 1)", () => {
	it("retracts a pending extension_ui approval card before aborting", async () => {
		const { io, pushLine } = createFakeProcessIo();
		vi.mocked(spawnProcessIo).mockResolvedValue(io);

		const handle = await piAdapter.start("/tmp/project");
		const iterator = handle.events[Symbol.asyncIterator]();

		pushLine(
			JSON.stringify({
				type: "extension_ui_request",
				id: "req-y",
				method: "confirm",
				title: "Clear session?",
			})
		);
		await iterator.next(); // the approval card

		handle.sendWith?.("fresh start", "interrupt");

		const { value: retract } = await iterator.next();
		expect(retract).toMatchObject({
			kind: "approval",
			cancelled: true,
			requestId: "req-y",
			title: "Cancelled",
		});
	});
});

describe("piAdapter - stop retracts pending extension_ui cards before closing events (R3-1 finding 1/3)", () => {
	it("emits a cancelled approval event for a pending confirm card before the queue closes", async () => {
		const { io, pushLine } = createFakeProcessIo();
		vi.mocked(spawnProcessIo).mockResolvedValue(io);

		const handle = await piAdapter.start("/tmp/project");
		const iterator = handle.events[Symbol.asyncIterator]();

		pushLine(
			JSON.stringify({
				type: "extension_ui_request",
				id: "req-confirm-2",
				method: "confirm",
				title: "Clear session?",
			})
		);
		await iterator.next(); // the approval card

		handle.stop();

		const { value: approvalRetract } = await iterator.next();
		expect(approvalRetract).toMatchObject({
			kind: "approval",
			cancelled: true,
			requestId: "req-confirm-2",
			title: "Cancelled",
		});

		const result = await iterator.next();
		expect(result.done).toBe(true);
	});
});
