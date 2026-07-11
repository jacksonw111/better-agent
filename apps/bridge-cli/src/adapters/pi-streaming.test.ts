import { describe, expect, it } from "vitest";
import { makePiStreamingTracker } from "./pi-streaming";

describe("makePiStreamingTracker", () => {
	it("starts idle", () => {
		expect(makePiStreamingTracker().isStreaming()).toBe(false);
	});

	it("becomes streaming on agent_start, and stays streaming through message_update", () => {
		const tracker = makePiStreamingTracker();

		tracker.onLine({ type: "agent_start" });
		expect(tracker.isStreaming()).toBe(true);

		tracker.onLine({
			type: "message_update",
			assistantMessageEvent: { type: "text_delta", delta: "hi" },
		});
		expect(tracker.isStreaming()).toBe(true);
	});

	// R2-T3 item 3: `agent_end` is NOT the true idle signal (auto-retries can
	// follow it) — only `agent_settled` resets the tracker.
	it("stays streaming through agent_end, and only resets on agent_settled", () => {
		const tracker = makePiStreamingTracker();
		tracker.onLine({ type: "agent_start" });

		tracker.onLine({ type: "agent_end" });
		expect(tracker.isStreaming()).toBe(true);

		tracker.onLine({ type: "agent_settled" });
		expect(tracker.isStreaming()).toBe(false);
	});

	it("ignores lines with no string type, or that aren't records", () => {
		const tracker = makePiStreamingTracker();
		tracker.onLine({ type: 42 });
		tracker.onLine(null);
		tracker.onLine("agent_start");
		expect(tracker.isStreaming()).toBe(false);
	});

	// R2-T3 review finding 2: if pi's abort path never emits agent_settled
	// (its normal end-of-turn signal), the tracker would stick `true` forever.
	// `reset()` is the interrupt/stop escape hatch back to idle.
	it("reset() forces the tracker back to idle from any state", () => {
		const tracker = makePiStreamingTracker();
		tracker.onLine({ type: "agent_start" });
		expect(tracker.isStreaming()).toBe(true);

		tracker.reset();
		expect(tracker.isStreaming()).toBe(false);
	});
});
