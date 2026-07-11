// R3-T1: shared `sendWith("interrupt")` for the three adapters whose entire
// busy-turn story IS "abort the in-flight turn, then send fresh" — none of
// claude-code/codex/opencode support "steer" (only pi does — see
// pi-send-with.ts's richer three-way version). Split into one shared
// implementation, rather than three near-identical inline closures, since
// all three adapter files already sit close to the repo's 300-line cap.

import type { TextWhen } from "./types";

/** R3-1 review finding 2 (ASSUMPTION, unverified — no `codex` binary in this
 * sandbox): the longest this helper waits for `doInterrupt()`'s own request
 * to settle before sending anyway. codex's `turn/interrupt` is a real
 * JSON-RPC round trip (unlike claude-code/opencode's synchronous-looking
 * `doInterrupt`, which returns `undefined` and is unaffected — see
 * `afterInterruptSettles` below); firing `turn/start` immediately, without
 * waiting, raced codex mid-abort and could reject or silently drop the new
 * turn. No product spec pins this figure down — 500ms is long enough for a
 * same-process RPC round trip to normally complete, short enough that a
 * codex build whose `turn/interrupt` never resolves doesn't stall the send
 * indefinitely. */
const INTERRUPT_SETTLE_TIMEOUT_MS = 500;

interface InterruptThenSendDeps {
	/** May return `void` (claude-code/opencode's synchronous-looking
	 * interrupt) or a `Promise` that settles once the interrupt request
	 * itself has been acknowledged (codex's — see `codex.ts`'s `doInterrupt`).
	 * When it returns a promise, `sendWith("interrupt")` waits for it (or the
	 * timeout above, whichever comes first) before sending — see the finding
	 * 2 doc above. */
	doInterrupt(): Promise<void> | void;
	doSend(text: string): void;
}

/** Resolves once `result` settles, or after `INTERRUPT_SETTLE_TIMEOUT_MS`,
 * whichever comes first — a synchronous `doInterrupt` (no promise returned)
 * resolves immediately, so this is a no-op wait for claude-code/opencode. */
function afterInterruptSettles(result: Promise<void> | void): Promise<void> {
	if (!result) {
		return Promise.resolve();
	}
	return Promise.race([
		result,
		new Promise<void>((resolve) => {
			setTimeout(resolve, INTERRUPT_SETTLE_TIMEOUT_MS);
		}),
	]);
}

/** For `when === "interrupt"`, calls `doInterrupt()` then, once it settles
 * (see `afterInterruptSettles`), `doSend(text)`; otherwise (any other `when`,
 * including "queue" — reachable only if a caller bypasses
 * `dispatchTextCommand`'s own "queue never calls sendWith" filtering) just
 * `doSend(text)`, since these adapters have no third policy to apply. */
export function makeInterruptThenSend(
	deps: InterruptThenSendDeps
): (text: string, when: TextWhen) => void {
	return (text, when) => {
		if (when === "interrupt") {
			afterInterruptSettles(deps.doInterrupt()).then(() => {
				deps.doSend(text);
			});
			return;
		}
		deps.doSend(text);
	};
}
