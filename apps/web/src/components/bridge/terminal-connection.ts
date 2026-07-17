// Pure state machine for the terminal's connection indicator. SSE is the
// primary transport; after MAX_SSE_FAILURES consecutive failures it degrades
// to polling permanently for that session (no automatic recovery back to
// live — a session refresh/reselect resets it via the "reset" action).

export type ConnectionStatus = "connecting" | "live" | "polling";

export const MAX_SSE_FAILURES = 3;

export interface ConnectionState {
	everConnected: boolean;
	failureCount: number;
	status: ConnectionStatus;
}

export const initialConnectionState: ConnectionState = {
	status: "connecting",
	failureCount: 0,
	everConnected: false,
};

export type ConnectionAction =
	| { type: "open" }
	| {
			type: "error";
			/** True when the connection that just dropped had been alive past the
			 * caller's stability window (SSE_STABLE_RESET_MS, use-sse-connection.ts)
			 * — only then does the failure streak restart at 1. An `open` alone no
			 * longer clears the count: a server that accepts the connection and
			 * drops it a moment later used to reset the streak on every flap,
			 * keeping the client in a tight open-then-close reconnect loop forever
			 * instead of ever degrading to polling. */
			wasStable?: boolean;
	  }
	| { type: "polled" }
	| { type: "reset" };

export function connectionReducer(
	state: ConnectionState,
	action: ConnectionAction
): ConnectionState {
	switch (action.type) {
		case "open":
			return { ...state, status: "live", everConnected: true };
		case "polled":
			return { ...state, everConnected: true };
		case "error": {
			const previousFailures = action.wasStable ? 0 : state.failureCount;
			const failureCount = previousFailures + 1;
			const status =
				failureCount >= MAX_SSE_FAILURES ? "polling" : "connecting";
			return { ...state, status, failureCount };
		}
		case "reset":
			return initialConnectionState;
		default:
			return state;
	}
}
