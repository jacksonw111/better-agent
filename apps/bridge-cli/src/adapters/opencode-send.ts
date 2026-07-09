// Extracted out of opencode.ts purely to keep that file under the repo's
// 300-line file cap.

import type { NormalizedEvent } from "../normalize/types";
import { userMessageEvent } from "../normalize/types";
import type { JsonRpcIo } from "./jsonrpc-io";
import { bumpTurnEpoch, type TurnEpochRef } from "./turn-epoch";

/** The `send` control — echoes the user's line and issues `session/prompt`.
 *
 * RC-T5: unlike every other adapter, ACP opencode had no "the turn is over"
 * status signal at all — `session/prompt`'s resolution was only ever used to
 * surface a failure. Without one, the activity watchdog (session-watchdog.ts)
 * would never see a turn as complete and could eventually false-stall a
 * perfectly idle session. `requestEpoch` guards the success push the same way
 * `isStaleTurnEvent` guards everything else: if `interrupt()`/a fresh `send()`
 * already superseded this turn by the time the RPC resolves, this push is a
 * straggler and must NOT be reported as this (wrong) turn's end. */
export function opencodeSend(
	rpc: JsonRpcIo,
	events: { push(event: NormalizedEvent): void },
	getSessionId: () => string | undefined,
	epoch: TurnEpochRef
): (text: string) => void {
	return (text: string) => {
		// A new turn begins — bump the epoch BEFORE pushing the user's own
		// turn-start event (see the RC-T3 note on `opencodeAdapter.start`).
		const requestEpoch = bumpTurnEpoch(epoch);
		events.push(userMessageEvent(text));
		rpc
			.request("session/prompt", {
				sessionId: getSessionId(),
				prompt: [{ type: "text", text }],
			})
			.then(() => {
				if (epoch.current === requestEpoch) {
					events.push({ kind: "status", status: "turn_end" });
				}
			})
			.catch((error: unknown) => {
				events.push({
					kind: "error",
					message: "opencode session/prompt failed",
					detail: error,
				});
			});
	};
}
