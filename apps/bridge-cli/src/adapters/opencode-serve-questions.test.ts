// R3-T3: end-to-end `question.asked` wiring through `startServe()` — split
// out of opencode-serve.test.ts purely to keep both files under the repo's
// 300-line file cap.

import { afterEach, describe, expect, it, vi } from "vitest";
import { APPROVAL_TIMEOUT_MS } from "./approvals";
import { startServe } from "./opencode-serve-test-support";

vi.mock("./process-io", () => ({ spawnProcessIo: vi.fn() }));

afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe("opencodeServeAdapter - question.asked (R3-T3)", () => {
	it("surfaces a question.asked frame as a question event", async () => {
		const { handle, server } = await startServe();
		const iterator = handle.events[Symbol.asyncIterator]();
		await iterator.next(); // session_ready

		server.emitSse({
			type: "question.asked",
			properties: {
				id: "q_1",
				sessionID: "ses_1",
				title: "Pick an environment",
				questions: [{ question: "Which one?", options: ["staging", "prod"] }],
			},
		});

		const { value: question } = await iterator.next();
		expect(question).toMatchObject({
			kind: "question",
			requestId: "q_1",
			title: "Pick an environment",
			questions: [{ text: "Which one?", options: ["staging", "prod"] }],
		});
	});
});

// Split into its own `describe` purely to keep each callback under the
// repo's max-lines-per-function gate.
describe("opencodeServeAdapter - question.asked reply/reject (R3-T3)", () => {
	it("posts /question/:id/reply with the chosen answers", async () => {
		const { handle, server } = await startServe();
		const iterator = handle.events[Symbol.asyncIterator]();
		await iterator.next(); // session_ready

		server.emitSse({
			type: "question.asked",
			properties: { id: "q_1", sessionID: "ses_1", questions: [] },
		});
		await iterator.next(); // the question card

		handle.answerQuestion?.("q_1", [["staging"]]);
		await vi.waitFor(() => {
			const reply = server.calls.find((call) =>
				call.url.endsWith("/question/q_1/reply")
			);
			expect(reply).toBeDefined();
		});
		const reply = server.calls.find((call) =>
			call.url.endsWith("/question/q_1/reply")
		);
		expect(reply).toMatchObject({
			method: "POST",
			body: { answers: [["staging"]] },
		});
	});

	it("posts /question/:id/reject when answered with an empty answers array", async () => {
		const { handle, server } = await startServe();
		const iterator = handle.events[Symbol.asyncIterator]();
		await iterator.next(); // session_ready

		server.emitSse({
			type: "question.asked",
			properties: { id: "q_2", sessionID: "ses_1", questions: [] },
		});
		await iterator.next(); // the question card

		handle.answerQuestion?.("q_2", []);
		await vi.waitFor(() => {
			const reject = server.calls.find((call) =>
				call.url.endsWith("/question/q_2/reject")
			);
			expect(reject).toBeDefined();
		});
	});
});

// Split into its own `describe` purely to keep each callback under the
// repo's max-lines-per-function gate.
describe("opencodeServeAdapter - question.asked never hangs forever (R3-T3)", () => {
	it("an unanswered question resolves declined via the shared timeout", async () => {
		vi.useFakeTimers();
		try {
			const { handle, server } = await startServe();
			const iterator = handle.events[Symbol.asyncIterator]();
			await iterator.next(); // session_ready

			server.emitSse({
				type: "question.asked",
				properties: { id: "q_3", sessionID: "ses_1", questions: [] },
			});
			await iterator.next(); // the question card

			await vi.advanceTimersByTimeAsync(APPROVAL_TIMEOUT_MS);

			const reject = server.calls.find((call) =>
				call.url.endsWith("/question/q_3/reject")
			);
			expect(reject).toBeDefined();
			const { value: timeoutEvent } = await iterator.next();
			expect(timeoutEvent).toMatchObject({
				kind: "question",
				cancelled: true,
				requestId: "q_3",
				title: "Timed out — declined",
			});
		} finally {
			vi.useRealTimers();
		}
	});
});
