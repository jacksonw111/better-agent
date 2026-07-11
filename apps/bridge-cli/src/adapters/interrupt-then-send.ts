// R3-T1: shared `sendWith("interrupt")` for the three adapters whose entire
// busy-turn story IS "abort the in-flight turn, then send fresh" — none of
// claude-code/codex/opencode support "steer" (only pi does — see
// pi-send-with.ts's richer three-way version). Split into one shared
// implementation, rather than three near-identical inline closures, since
// all three adapter files already sit close to the repo's 300-line cap.

import type { TextWhen } from "./types";

interface InterruptThenSendDeps {
	doInterrupt(): void;
	doSend(text: string): void;
}

/** For `when === "interrupt"`, calls `doInterrupt()` then `doSend(text)`;
 * otherwise (any other `when`, including "queue" — reachable only if a
 * caller bypasses `dispatchTextCommand`'s own "queue never calls sendWith"
 * filtering) just `doSend(text)`, since these adapters have no third policy
 * to apply. */
export function makeInterruptThenSend(
	deps: InterruptThenSendDeps
): (text: string, when: TextWhen) => void {
	return (text, when) => {
		if (when === "interrupt") {
			deps.doInterrupt();
		}
		deps.doSend(text);
	};
}
