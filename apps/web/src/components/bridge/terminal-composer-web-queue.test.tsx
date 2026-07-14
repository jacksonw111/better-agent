// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { TextWhen } from "./agent-capabilities";
import { TerminalComposer } from "./terminal-composer";
import { pickSelectOption } from "./terminal-test-helpers";
import { useWebQueue } from "./use-web-queue";

vi.mock("sonner", () => ({
	toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

// P2-T5: the composer + web-side busy queue wired the way terminal.tsx wires
// them — a busy submit with the default "queue" policy is HELD as an
// editable/deletable card; steer/interrupt picks still send immediately.

const ALL_BUSY_MODES: TextWhen[] = ["queue", "steer", "interrupt"];

afterEach(cleanup);

function Harness({
	onSend,
	turnInFlight,
}: {
	onSend: (text: string, when?: TextWhen) => void;
	turnInFlight: boolean;
}) {
	const webQueue = useWebQueue({
		ended: false,
		send: onSend,
		sessionId: "s1",
		turnInFlight,
	});
	return (
		<TerminalComposer
			busyModes={ALL_BUSY_MODES}
			disabled={false}
			onSend={onSend}
			sending={false}
			turnInFlight={turnInFlight}
			webQueue={webQueue}
		/>
	);
}

function renderHarness() {
	const onSend = vi.fn().mockResolvedValue(undefined);
	const utils = render(<Harness onSend={onSend} turnInFlight={true} />);
	const view = within(utils.container);
	const textarea = view.getByLabelText("Message") as HTMLTextAreaElement;
	const submitText = (text: string) => {
		fireEvent.change(textarea, { target: { value: text } });
		fireEvent.keyDown(textarea, { key: "Enter" });
	};
	return { ...utils, onSend, submitText, textarea, view };
}

it("holds a busy 'queue' submit as a card instead of sending", () => {
	const { onSend, submitText, textarea, view } = renderHarness();

	submitText("hold this");

	expect(onSend).not.toHaveBeenCalled();
	expect(textarea.value).toBe("");
	expect(view.getByText("待发送 1 条 — 本回合结束后自动发出")).toBeDefined();
	expect(view.getByText("hold this")).toBeDefined();
});

it("edit loads the card's text back into the composer and removes the card", () => {
	const { submitText, textarea, view } = renderHarness();

	submitText("tweak me");
	fireEvent.click(view.getByRole("button", { name: "编辑待发送消息" }));

	expect(textarea.value).toBe("tweak me");
	expect(view.queryByText("待发送 1 条 — 本回合结束后自动发出")).toBeNull();
});

it("delete removes the card so it never sends", async () => {
	const { onSend, rerender, submitText, view } = renderHarness();

	submitText("discard me");
	fireEvent.click(view.getByRole("button", { name: "删除待发送消息" }));
	rerender(<Harness onSend={onSend} turnInFlight={false} />);

	await waitFor(() => {
		expect(view.queryByText("discard me")).toBeNull();
	});
	expect(onSend).not.toHaveBeenCalled();
});

it("flushes queued cards FIFO through onSend when the turn completes", async () => {
	const { onSend, rerender, submitText } = renderHarness();

	submitText("first");
	submitText("second");
	rerender(<Harness onSend={onSend} turnInFlight={false} />);

	await waitFor(() => {
		expect(onSend.mock.calls).toEqual([["first"], ["second"]]);
	});
});

it("a 'steer' pick bypasses the web queue and sends immediately", async () => {
	const { container, onSend, submitText, view } = renderHarness();

	await pickSelectOption(container, "发送方式", "插话");
	submitText("right now");

	expect(onSend).toHaveBeenCalledWith("right now", "steer");
	expect(view.queryByText("right now")).toBeNull();
});
