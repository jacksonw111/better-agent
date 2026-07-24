import { describe, expect, it } from "vitest";
import { createFrameCoalescer } from "./frame-coalescer";

/** A manual timer: `push` schedules exactly one pending fire we trigger by hand. */
function manualTimer() {
	let pending: (() => void) | null = null;
	return {
		setTimer: (fn: () => void) => {
			pending = fn;
			return 1;
		},
		clearTimer: () => {
			pending = null;
		},
		fire: () => {
			const fn = pending;
			pending = null;
			fn?.();
		},
		get scheduled() {
			return pending !== null;
		},
	};
}

function text(buf: Uint8Array): string {
	return new TextDecoder().decode(buf);
}

describe("frame coalescer — windowing", () => {
	it("merges a burst into one flush when the window fires", () => {
		const timer = manualTimer();
		const flushed: string[] = [];
		const coalescer = createFrameCoalescer({
			onFlush: (m) => flushed.push(text(m)),
			setTimer: timer.setTimer,
			clearTimer: timer.clearTimer,
		});
		coalescer.push(new TextEncoder().encode("a"));
		coalescer.push(new TextEncoder().encode("b"));
		coalescer.push(new TextEncoder().encode("c"));
		expect(flushed).toEqual([]); // nothing until the window fires
		timer.fire();
		expect(flushed).toEqual(["abc"]);
	});
});

describe("frame coalescer — early flush & dispose", () => {
	it("flushes early once maxBytes is reached, without waiting for the timer", () => {
		const timer = manualTimer();
		const flushed: string[] = [];
		const coalescer = createFrameCoalescer({
			maxBytes: 3,
			onFlush: (m) => flushed.push(text(m)),
			setTimer: timer.setTimer,
			clearTimer: timer.clearTimer,
		});
		coalescer.push(new TextEncoder().encode("xyz"));
		expect(flushed).toEqual(["xyz"]);
		expect(timer.scheduled).toBe(false);
	});

	it("flush() emits the pending window immediately", () => {
		const timer = manualTimer();
		const flushed: string[] = [];
		const coalescer = createFrameCoalescer({
			onFlush: (m) => flushed.push(text(m)),
			setTimer: timer.setTimer,
			clearTimer: timer.clearTimer,
		});
		coalescer.push(new TextEncoder().encode("hi"));
		coalescer.flush();
		expect(flushed).toEqual(["hi"]);
	});

	it("dispose() drops the pending window without flushing", () => {
		const timer = manualTimer();
		const flushed: string[] = [];
		const coalescer = createFrameCoalescer({
			onFlush: (m) => flushed.push(text(m)),
			setTimer: timer.setTimer,
			clearTimer: timer.clearTimer,
		});
		coalescer.push(new TextEncoder().encode("hi"));
		coalescer.dispose();
		timer.fire();
		expect(flushed).toEqual([]);
	});
});
