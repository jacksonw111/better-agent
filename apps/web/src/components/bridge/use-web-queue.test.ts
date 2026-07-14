// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { type UseWebQueueArgs, useWebQueue } from "./use-web-queue";

vi.mock("sonner", () => ({
	toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

function setup(initial?: Partial<UseWebQueueArgs>) {
	const send = vi.fn().mockResolvedValue(undefined);
	const view = renderHook((args: UseWebQueueArgs) => useWebQueue(args), {
		initialProps: {
			ended: false,
			send,
			sessionId: "s1",
			turnInFlight: true,
			...initial,
		},
	});
	const rerender = (next: Partial<UseWebQueueArgs>) =>
		view.rerender({
			ended: false,
			send,
			sessionId: "s1",
			turnInFlight: true,
			...initial,
			...next,
		});
	return { rerender, result: view.result, send };
}

it("snapshots text, the queue policy, and a timestamp at enqueue time", () => {
	const { result } = setup();

	act(() => result.current.enqueue("hold me"));

	const [item] = result.current.items;
	expect(item.text).toBe("hold me");
	expect(item.when).toBe("queue");
	expect(typeof item.queuedAt).toBe("number");
});

it("flushes FIFO on the busy→idle transition, once", async () => {
	const { rerender, result, send } = setup();

	act(() => {
		result.current.enqueue("first");
		result.current.enqueue("second");
	});
	rerender({ turnInFlight: false });

	await waitFor(() => {
		expect(send.mock.calls).toEqual([["first"], ["second"]]);
	});
	expect(result.current.items).toEqual([]);

	// A second falling edge finds nothing left to flush.
	rerender({ turnInFlight: true });
	rerender({ turnInFlight: false });
	expect(send).toHaveBeenCalledTimes(2);
});

it("items queued after a flush go out — in order — on the next transition", async () => {
	const { rerender, result, send } = setup();

	act(() => result.current.enqueue("first"));
	rerender({ turnInFlight: false });
	act(() => result.current.enqueue("later"));
	rerender({ turnInFlight: true });
	rerender({ turnInFlight: false });

	await waitFor(() => {
		expect(send.mock.calls).toEqual([["first"], ["later"]]);
	});
});

it("removing an item keeps it out of the flush", async () => {
	const { rerender, result, send } = setup();

	act(() => {
		result.current.enqueue("keep");
		result.current.enqueue("drop");
	});
	act(() => result.current.remove(result.current.items[1].id));
	rerender({ turnInFlight: false });

	await waitFor(() => {
		expect(send.mock.calls).toEqual([["keep"]]);
	});
});

it("drops the queue (with a toast) on a session switch instead of leaking it", async () => {
	const { toast } = await import("sonner");
	const { rerender, result, send } = setup();

	act(() => result.current.enqueue("stranded"));
	rerender({ sessionId: "s2", turnInFlight: false });

	expect(result.current.items).toEqual([]);
	expect(send).not.toHaveBeenCalled();
	expect(toast.warning).toHaveBeenCalledWith("已丢弃 1 条待发送消息");
});

it("drops the queue (with a toast) when the session ends", () => {
	const { rerender, result, send } = setup();

	act(() => result.current.enqueue("stranded"));
	rerender({ ended: true, turnInFlight: false });

	expect(result.current.items).toEqual([]);
	expect(send).not.toHaveBeenCalled();
});
