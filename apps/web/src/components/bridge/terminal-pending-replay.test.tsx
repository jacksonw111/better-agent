// @vitest-environment jsdom
import { render, waitFor, within } from "@testing-library/react";
import { act } from "react";
import { expect, it } from "vitest";
import { Terminal } from "./terminal";
import {
	ALLOW_BUTTON_PATTERN,
	ALLOW_CHOSEN_BUTTON_PATTERN,
	approvalRaw,
	makeControllableTransport,
	SESSION,
	waitForConnect,
} from "./terminal-test-helpers";

// P5-1: pending-approval replay on (re)connect — a still-unanswered approval
// whose event fell outside the history seed window must still show as an
// actionable card (replayed from `bridge.pendingRequests`), and an approval
// answered from ANOTHER device must render as handled instead of actionable.

it("replays a still-open approval from outside the seeded window as an actionable card", async () => {
	const fake = makeControllableTransport();
	fake.history.mockResolvedValue([
		{ seq: 1, event: { kind: "message", role: "assistant", text: "hi" } },
	]);
	const approval = approvalRaw(42, "req-9");
	fake.pendingRequests.mockResolvedValue({
		answered: [],
		pending: [{ seq: approval.id, requestId: "req-9", event: approval.data }],
	});
	const { container } = render(
		<Terminal session={SESSION} transport={fake.transport} />
	);

	const view = within(container);
	const allow = (await waitFor(() =>
		view.getByRole("button", { name: ALLOW_BUTTON_PATTERN })
	)) as HTMLButtonElement;
	expect(allow.disabled).toBe(false);
	expect(fake.pendingRequests).toHaveBeenCalledWith({
		sessionId: SESSION.id,
	});

	// The live stream later redelivers the exact same persisted row — the
	// replayed card must not duplicate.
	await waitForConnect(fake);
	await act(() => {
		fake.current()?.onEvent(approval);
	});
	expect(
		view.getAllByRole("button", { name: ALLOW_BUTTON_PATTERN })
	).toHaveLength(1);
});

it("marks an approval answered from another device as handled, not actionable", async () => {
	const fake = makeControllableTransport();
	const approval = approvalRaw(1, "req-9");
	fake.history.mockResolvedValue([{ seq: approval.id, event: approval.data }]);
	fake.pendingRequests.mockResolvedValue({
		answered: [{ kind: "approval", optionId: "allow", requestId: "req-9" }],
		pending: [],
	});
	const { container } = render(
		<Terminal session={SESSION} transport={fake.transport} />
	);

	const view = within(container);
	const allow = (await waitFor(() =>
		view.getByRole("button", { name: ALLOW_CHOSEN_BUTTON_PATTERN })
	)) as HTMLButtonElement;
	expect(allow.disabled).toBe(true);
});

it("a transport without pendingRequests still seeds and connects (pre-P5-1 behavior)", async () => {
	const fake = makeControllableTransport();
	fake.transport.pendingRequests = undefined;
	fake.history.mockResolvedValue([
		{ seq: 1, event: { kind: "message", role: "assistant", text: "hi" } },
	]);
	render(<Terminal session={SESSION} transport={fake.transport} />);

	await waitForConnect(fake);
	expect(fake.connectCalls).toHaveLength(1);
});
