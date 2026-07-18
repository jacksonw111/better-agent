import type { RelayEvent } from "@better-agent/agent/bridge/relay-store";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runBridgeEventStream } from "./bridge-stream-run";

const HEARTBEAT_MS = 1000;

function makeHarness(overrides?: {
	writeEvent?: () => Promise<void>;
	writePing?: () => Promise<void>;
}) {
	let onEvent: ((event: RelayEvent) => void) | null = null;
	let abort: (() => void) | null = null;
	const unsubscribe = vi.fn();
	const writeEvent = vi.fn(
		overrides?.writeEvent ?? (() => Promise.resolve(undefined))
	);
	const writePing = vi.fn(
		overrides?.writePing ?? (() => Promise.resolve(undefined))
	);
	const done = runBridgeEventStream({
		heartbeatMs: HEARTBEAT_MS,
		io: {
			onAbort: (handler) => {
				abort = handler;
			},
			writeEvent,
			writePing,
		},
		subscribe: (handler) => {
			onEvent = handler;
			return unsubscribe;
		},
	});
	return {
		abort: () => abort?.(),
		done,
		emit: (event: RelayEvent) => onEvent?.(event),
		unsubscribe,
		writeEvent,
		writePing,
	};
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

it("forwards subscribed events and periodic pings while the write side is healthy", async () => {
	const harness = makeHarness();
	harness.emit({ id: 1, data: { kind: "status" } });
	expect(harness.writeEvent).toHaveBeenCalledWith({
		id: 1,
		data: { kind: "status" },
	});

	await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
	expect(harness.writePing).toHaveBeenCalledTimes(1);
	expect(harness.unsubscribe).not.toHaveBeenCalled();

	harness.abort();
	await harness.done;
});

it("tears down (unsubscribe + resolve) when an event write fails, instead of swallowing it", async () => {
	const harness = makeHarness({
		writeEvent: () => Promise.reject(new Error("connection gone")),
	});
	harness.emit({ id: 1, data: {} });

	await harness.done;
	expect(harness.unsubscribe).toHaveBeenCalledTimes(1);

	// The heartbeat died with the stream — no more pings after teardown.
	await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 3);
	expect(harness.writePing).not.toHaveBeenCalled();
});

it("tears down when a heartbeat ping write fails", async () => {
	const harness = makeHarness({
		writePing: () => Promise.reject(new Error("connection gone")),
	});
	await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);

	await harness.done;
	expect(harness.unsubscribe).toHaveBeenCalledTimes(1);
});

it("cleans up exactly once on client abort", async () => {
	const harness = makeHarness();
	harness.abort();
	harness.abort();

	await harness.done;
	expect(harness.unsubscribe).toHaveBeenCalledTimes(1);
});
