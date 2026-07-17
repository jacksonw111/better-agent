// @vitest-environment jsdom
import { render, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { Terminal } from "./terminal";
import { makeControllableTransport, SESSION } from "./terminal-test-helpers";

vi.mock("sonner", () => ({
	toast: { error: vi.fn(), success: vi.fn() },
}));

// fix-question-replay: mirrors terminal-approval.test.tsx's replay repro for
// the question flow. Split into its own file (not appended there) to keep
// terminal-approval.test.tsx under the repo's max-lines-per-file gate.

const QUESTION_HISTORY_EVENT = {
	kind: "question",
	requestId: "q-1",
	title: "Need more info",
	questions: [{ text: "Which env?", options: ["staging", "prod"] }],
};

it("renders a replayed question as answered when history carries its resolution event", async () => {
	const fake = makeControllableTransport();
	// The bug's exact shape: the user answered long ago, the answer command has
	// since expired from the relay window (pendingRequests reports nothing),
	// and the page reloads — history is ALL the client has. The CLI's
	// persisted resolution event must reconstruct the answered state.
	fake.history.mockResolvedValue([
		{
			seq: 1,
			event: {
				...QUESTION_HISTORY_EVENT,
				timeoutAt: Date.now() - 60_000,
				timeoutMs: 300_000,
			},
		},
		{
			seq: 2,
			event: {
				kind: "question",
				answeredAnswers: [["staging"]],
				questions: [],
				requestId: "q-1",
				title: "Answered",
			},
		},
	]);
	const { container } = render(
		<Terminal session={SESSION} transport={fake.transport} />
	);

	const view = within(container);
	await waitFor(() => {
		const staging = view.getByRole("button", {
			name: "staging",
		}) as HTMLButtonElement;
		expect(staging.disabled).toBe(true);
		expect(staging.getAttribute("aria-pressed")).toBe("true");
	});
	// The resolution event marks the ORIGINAL card — it never renders a second
	// question card of its own.
	expect(view.getAllByRole("button", { name: "staging" })).toHaveLength(1);
	// And an answered card must never show the neutral unrecorded notice.
	expect(view.queryByText("已处理（结果未记录）")).toBeNull();
});
