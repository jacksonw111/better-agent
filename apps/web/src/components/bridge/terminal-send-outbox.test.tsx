// @vitest-environment jsdom
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { act } from "react";
import { expect, it } from "vitest";
import { Terminal } from "./terminal";
import {
	ALLOW_BUTTON_PATTERN,
	approvalRaw,
	makeControllableTransport,
	SESSION,
	waitForConnect,
} from "./terminal-test-helpers";

// fix-send-outbox: the outbox as the mounted terminal actually uses it. The
// queue's own mechanics (backoff, exhaustion, persistence, ordering) are unit
// tested in send-outbox.test.ts; these cover the wiring that only exists once
// the real component is driving it.

/** Matches a raw approval command leaked into the transcript as text. */
const APPROVAL_JSON_PATTERN = /"type": "approval"/;

async function mounted() {
	const fake = makeControllableTransport();
	// Nothing ever resolves, so every send stays in flight for the assertions.
	fake.sendInput.mockReturnValue(new Promise(() => undefined));
	const { container } = render(
		<Terminal session={SESSION} transport={fake.transport} />
	);
	await waitForConnect(fake);
	await act(() => {
		fake.current()?.onOpen();
	});
	return { fake, view: within(container) };
}

it("marks the user's own line as sending until the send lands", async () => {
	const { view } = await mounted();

	fireEvent.change(view.getByLabelText("Message"), {
		target: { value: "ship it" },
	});
	fireEvent.click(view.getByRole("button", { name: "Send" }));

	await waitFor(() => {
		expect(view.getByText("ship it")).toBeDefined();
	});
	// The whole point of the fix: an in-flight message says so, rather than
	// looking exactly like a delivered one.
	expect(view.getByText("Sending…")).toBeDefined();
});

it("queues an approval decision WITHOUT echoing it as a chat line", async () => {
	const { fake, view } = await mounted();
	await act(() => {
		fake.current()?.onEvent(approvalRaw(1, "req-1"));
	});

	await act(() => {
		fireEvent.click(view.getByRole("button", { name: ALLOW_BUTTON_PATTERN }));
	});

	await waitFor(() => {
		expect(fake.sendInput).toHaveBeenCalledWith({
			sessionId: SESSION.id,
			data: { type: "approval", requestId: "req-1", optionId: "allow" },
			idempotencyKey: expect.any(String),
		});
	});
	// A control command rides the same reliable queue as chat, but must never
	// produce a fake user bubble (or a "Sending…" line) in the transcript.
	expect(view.queryByText("Sending…")).toBeNull();
	expect(view.queryByText(APPROVAL_JSON_PATTERN)).toBeNull();
});
