// @vitest-environment jsdom
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { act } from "react";
import { toast } from "sonner";
import { expect, it, vi } from "vitest";
import { Terminal } from "./terminal";
import {
	ALLOW_BUTTON_PATTERN,
	ALLOW_CHOSEN_BUTTON_PATTERN,
	approvalRaw,
	DENY_BUTTON_PATTERN,
	makeControllableTransport,
	OTHER_SESSION,
	SESSION,
	waitForConnect,
} from "./terminal-test-helpers";

vi.mock("sonner", () => ({
	toast: { error: vi.fn(), success: vi.fn() },
}));

// Not grouped under a `describe` — same reasoning as terminal.test.tsx: each
// of these already fully exercises a render + a run of act()s, and the
// repo's max-lines-per-function limit counts a wrapping describe callback's
// body too. Split out of terminal.test.tsx to stay under the max-lines-per-
// file gate while covering the approval answer/rollback/replay/reset paths.

it("answers an approval via sendInput, disables its buttons, and shows the chosen option", async () => {
	const fake = makeControllableTransport();
	const { container } = render(
		<Terminal session={SESSION} transport={fake.transport} />
	);
	await waitForConnect(fake);
	await act(() => {
		fake.current()?.onOpen();
	});
	await act(() => {
		fake.current()?.onEvent(approvalRaw(1, "req-1"));
	});

	const view = within(container);
	await act(() => {
		fireEvent.click(view.getByRole("button", { name: ALLOW_BUTTON_PATTERN }));
	});

	await waitFor(() => {
		expect(fake.sendInput).toHaveBeenCalledWith({
			sessionId: SESSION.id,
			data: {
				type: "approval",
				requestId: "req-1",
				optionId: "allow",
			},
			// fix-send-outbox: every send now carries the outbox's idempotency key.
			idempotencyKey: expect.any(String),
		});
	});
	const allowButton = view.getByRole("button", {
		name: ALLOW_CHOSEN_BUTTON_PATTERN,
	}) as HTMLButtonElement;
	const denyButton = view.getByRole("button", {
		name: "Deny",
	}) as HTMLButtonElement;
	expect(allowButton.disabled).toBe(true);
	expect(denyButton.disabled).toBe(true);
});

it("renders a fresh approval card as disabled when its requestId was already answered", async () => {
	const fake = makeControllableTransport();
	const { container } = render(
		<Terminal session={SESSION} transport={fake.transport} />
	);
	await waitForConnect(fake);
	await act(() => {
		fake.current()?.onOpen();
	});
	await act(() => {
		fake.current()?.onEvent(approvalRaw(1, "req-1"));
	});

	const view = within(container);
	await act(() => {
		fireEvent.click(view.getByRole("button", { name: ALLOW_BUTTON_PATTERN }));
	});
	await waitFor(() => {
		expect(fake.sendInput).toHaveBeenCalled();
	});

	// A distinct event id carrying the SAME requestId (e.g. the agent
	// re-emitting the request, or a differently-shaped replay) — mergeEvents
	// keeps this one since its id was never seen, so this exercises the
	// answered-by-requestId lookup for real, unlike replaying the identical
	// event id (which mergeEvents would drop entirely and prove nothing).
	await act(() => {
		fake.current()?.onEvent(approvalRaw(2, "req-1"));
	});

	const allowButtons = view.getAllByRole("button", {
		name: ALLOW_CHOSEN_BUTTON_PATTERN,
	}) as HTMLButtonElement[];
	const denyButtons = view.getAllByRole("button", {
		name: "Deny",
	}) as HTMLButtonElement[];
	expect(allowButtons).toHaveLength(2);
	expect(denyButtons).toHaveLength(2);
	for (const button of [...allowButtons, ...denyButtons]) {
		expect(button.disabled).toBe(true);
	}
});

// fix-send-outbox: an approval decision is exactly the kind of message that
// must not be lost, so it now rides the send outbox — a transient rejection is
// RETRIED (same idempotency key, so the agent can't act on it twice) instead
// of immediately rolling the card back and toasting at the user. The rollback
// and toast still exist, but only once the outbox exhausts its retries; that
// exhaustion path is covered without the real backoff in send-outbox.test.ts.
it("retries a rejected approval decision under the same key instead of rolling it back", async () => {
	const fake = makeControllableTransport();
	fake.sendInput.mockRejectedValueOnce(new Error("network down"));
	const { container } = render(
		<Terminal session={SESSION} transport={fake.transport} />
	);
	await waitForConnect(fake);
	await act(() => {
		fake.current()?.onOpen();
	});
	await act(() => {
		fake.current()?.onEvent(approvalRaw(1, "req-1"));
	});

	const view = within(container);
	await act(() => {
		fireEvent.click(view.getByRole("button", { name: ALLOW_BUTTON_PATTERN }));
	});

	await waitFor(
		() => {
			expect(fake.sendInput).toHaveBeenCalledTimes(2);
		},
		{ timeout: 3000 }
	);
	const [first, second] = fake.sendInput.mock.calls;
	expect(second[0]).toEqual(first[0]);
	expect(toast.error).not.toHaveBeenCalled();
	// The card stays answered throughout: the decision was never lost.
	const allowButton = view.getByRole("button", {
		name: ALLOW_CHOSEN_BUTTON_PATTERN,
	}) as HTMLButtonElement;
	expect(allowButton.disabled).toBe(true);
});

it("renders a replayed approval as answered (never timed out) when history carries its resolution event", async () => {
	const fake = makeControllableTransport();
	// The bug's exact shape: the user answered long ago, the answer command has
	// since expired from the relay window (pendingRequests reports nothing),
	// and the page reloads — history is ALL the client has. The CLI's
	// persisted resolution event must reconstruct the answered state.
	fake.history.mockResolvedValue([
		{
			seq: 1,
			event: {
				...approvalRaw(1, "req-1").data,
				timeoutAt: Date.now() - 60_000,
				timeoutMs: 300_000,
			},
		},
		{
			seq: 2,
			event: {
				kind: "approval",
				answeredOptionId: "allow",
				options: [],
				requestId: "req-1",
				title: "Answered",
			},
		},
	]);
	const { container } = render(
		<Terminal session={SESSION} transport={fake.transport} />
	);

	const view = within(container);
	await waitFor(() => {
		const allowButton = view.getByRole("button", {
			name: ALLOW_CHOSEN_BUTTON_PATTERN,
		}) as HTMLButtonElement;
		expect(allowButton.disabled).toBe(true);
	});
	// The resolution event marks the ORIGINAL card — it never renders a second
	// approval card of its own.
	expect(
		view.getAllByRole("button", { name: ALLOW_BUTTON_PATTERN })
	).toHaveLength(1);
	// And an answered card must never claim it timed out, even though its
	// timeoutAt is long past.
	expect(view.queryByText("已超时，按拒绝处理")).toBeNull();
});

it("clears the answered map when switching to a different session", async () => {
	const fake = makeControllableTransport();
	const { container, rerender } = render(
		<Terminal session={SESSION} transport={fake.transport} />
	);
	await waitForConnect(fake);
	await act(() => {
		fake.current()?.onOpen();
	});
	await act(() => {
		fake.current()?.onEvent(approvalRaw(1, "req-1"));
	});

	const view = within(container);
	await act(() => {
		fireEvent.click(view.getByRole("button", { name: ALLOW_BUTTON_PATTERN }));
	});
	await waitFor(() => {
		expect(fake.sendInput).toHaveBeenCalled();
	});

	// A session switch resets the feed AND reloads history for the new
	// session before its own live connection opens — wait for a fresh
	// `connectStream` call (not just a non-null `current()`, which would
	// still be the OLD session's stale connection right after rerender).
	const priorConnectCount = fake.connectCalls.length;
	rerender(<Terminal session={OTHER_SESSION} transport={fake.transport} />);
	await waitFor(() => {
		expect(fake.connectCalls.length).toBeGreaterThan(priorConnectCount);
	});
	await act(() => {
		fake.current()?.onOpen();
	});
	// Same requestId as before, but under the new session — if the answered
	// map hadn't been reset alongside the feed on session switch, this would
	// render disabled/chosen despite never being answered in this session.
	await act(() => {
		fake.current()?.onEvent(approvalRaw(1, "req-1"));
	});

	const allowButton = view.getByRole("button", {
		name: ALLOW_BUTTON_PATTERN,
	}) as HTMLButtonElement;
	const denyButton = view.getByRole("button", {
		name: DENY_BUTTON_PATTERN,
	}) as HTMLButtonElement;
	expect(allowButton.disabled).toBe(false);
	expect(denyButton.disabled).toBe(false);
});
