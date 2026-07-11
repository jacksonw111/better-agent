// R1-T2: several agent wire protocols (codex `commandExecution`/
// `mcpToolCall`, pi `tool_execution_start`/`tool_execution_end`, claude-code's
// `tool_use`/`tool_result` blocks) never report how long a tool ran — only
// that it started and finished, as two separate lines correlated by an id.
// This wraps a normalizer's per-line output and stamps `durationMs` onto a
// `started` → `completed`/`failed` `ToolEvent` pair by tracking wall-clock
// start times per id, adapter-side. Built on the same bounded cache pi's
// tool-name lookup uses (see bounded-cache.ts) so a tool call whose "end"
// line never arrives can't leak memory forever.

import { createBoundedCache } from "./bounded-cache";
import type { NormalizedEvent } from "./types";

export interface ToolDurationTracker {
	/** Returns the elapsed ms since `start(id)`, and forgets `id` either way —
	 * `undefined` if `id` was never started (or already ended/evicted). */
	end(id: string): number | undefined;
	/** Records `id` as started right now — overwrite-safe: a repeated start
	 * for the same id (codex re-fires `commandExecution` on every notification
	 * for the same item) just resets its clock. */
	start(id: string): void;
}

export function createToolDurationTracker(): ToolDurationTracker {
	const startedAt = createBoundedCache<number>();
	return {
		start(id: string): void {
			startedAt.set(id, Date.now());
		},
		end(id: string): number | undefined {
			const start = startedAt.get(id);
			startedAt.delete(id);
			return start === undefined ? undefined : Date.now() - start;
		},
	};
}

/** Attaches `durationMs` to `event` if it's a `ToolEvent` the tracker can
 * correlate: starts the clock on a `started` status, stamps + forgets it on
 * `completed`/`failed`. Every other event (and any `ToolEvent` whose id was
 * never started — an update line, or a tracker just created) passes through
 * unchanged. */
export function withToolDuration(
	tracker: ToolDurationTracker,
	event: NormalizedEvent
): NormalizedEvent {
	if (event.kind !== "tool") {
		return event;
	}
	if (event.status === "started") {
		tracker.start(event.id);
		return event;
	}
	const durationMs = tracker.end(event.id);
	return durationMs === undefined ? event : { ...event, durationMs };
}
