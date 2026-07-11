// R2-T3 item 1 (CRITICAL): pi ERRORS on a bare `prompt` frame sent while it's
// still mid-turn — this module is the shared state pi.ts's `send()` consults
// to decide whether to carry `streamingBehavior: "followUp"` (see
// normalize/pi-commands.ts's `buildPiPromptCommand` doc comment).
//
// ASSUMPTION (unverified — no `pi` binary in this sandbox; per the brief's
// researched rpc-types v0.80.6 shape): pi is "streaming" from `agent_start`
// (or an in-progress `message_update`, covering the case a send lands after
// the process resumed streaming without a fresh `agent_start`, e.g. a
// followUp queued mid-turn) through `agent_settled` — the TRUE end-of-turn
// signal (R2-T3 item 3; `agent_end` can be followed by auto-retries, so it
// does NOT mean idle — see normalize/pi.ts and session-watchdog.ts). Any
// other stdout line leaves the state unchanged.

import { isRecord } from "../normalize/types";

const PI_STREAMING_START_TYPES = new Set(["agent_start", "message_update"]);
const PI_STREAMING_END_TYPE = "agent_settled";

export interface PiStreamingTracker {
	/** True from an `agent_start`/`message_update` line up to (not including)
	 * the next `agent_settled` line. */
	isStreaming(): boolean;
	/** Feed every parsed stdout line here, same as `pi-status.ts`'s
	 * `onLine`-shaped trackers. */
	onLine(raw: unknown): void;
}

export function makePiStreamingTracker(): PiStreamingTracker {
	let streaming = false;
	return {
		isStreaming: () => streaming,
		onLine(raw: unknown): void {
			if (!isRecord(raw) || typeof raw.type !== "string") {
				return;
			}
			if (raw.type === PI_STREAMING_END_TYPE) {
				streaming = false;
			} else if (PI_STREAMING_START_TYPES.has(raw.type)) {
				streaming = true;
			}
		},
	};
}
