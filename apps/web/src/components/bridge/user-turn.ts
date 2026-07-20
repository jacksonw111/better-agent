import type { MessageEvent } from "./bridge-events";
import type { UserTurn } from "./bridge-turn-types";

/**
 * Builds the `UserTurn` for one user `message` event. Both optional field
 * groups ride along ONLY when actually present, so an ordinary
 * server-persisted user turn folds to the exact shape it always has (the turn
 * tests compare structurally):
 *
 *   - S3-T2 `origin`: the CLI-injected Task Start Context, rendered collapsed
 *     rather than as a bubble the user appears to have typed.
 *   - fix-send-outbox `sendKey`/`sendStatus`: present only on an optimistic
 *     echo the send outbox is still tracking, so the row can show
 *     sending/failed instead of passing an undelivered message off as sent.
 *
 * Split out of bridge-turns.ts's `foldMessage` to keep that file under the
 * repo's max-lines-per-file gate.
 */
export function makeUserTurn(id: number, event: MessageEvent): UserTurn {
	return {
		kind: "user",
		id,
		text: event.text,
		...(event.origin === "task-start" ? { origin: event.origin } : {}),
		...(event.sendKey === undefined
			? {}
			: { sendKey: event.sendKey, sendStatus: event.sendStatus }),
	};
}
