// Shared ws-level heartbeat for the server's long-lived WebSocket routes
// (bridge-ws.ts session duplex, computer-ws.ts control channel) — extracted
// from bridge-ws.ts in S2-T2 when the second consumer appeared.

/** Server-initiated ws-level ping cadence (protocol requirement, not app data). */
export const WS_PING_INTERVAL_MS = 15_000;
/** Terminate the raw socket once this many consecutive pings go unanswered. */
export const WS_MAX_MISSED_PONGS = 2;

/** The subset of the `ws` library's socket the heartbeat drives directly —
 * kept minimal/local instead of depending on `@types/ws` here. */
export interface HeartbeatRaw {
	off(event: "pong", listener: () => void): void;
	on(event: "pong", listener: () => void): void;
	ping(): void;
	terminate(): void;
}

/** Sends a ws-level ping every `WS_PING_INTERVAL_MS` and terminates the raw
 * socket after `WS_MAX_MISSED_PONGS` consecutive pings go unanswered. Returns
 * a cleanup function to call on close. `onPong` additionally lets the caller
 * treat a pong as liveness (touch a lastSeenAt). */
export function attachHeartbeat(
	raw: HeartbeatRaw,
	onPong: () => void
): () => void {
	let missedPongs = 0;
	const handlePong = () => {
		missedPongs = 0;
		onPong();
	};
	raw.on("pong", handlePong);
	const timer = setInterval(() => {
		if (missedPongs >= WS_MAX_MISSED_PONGS) {
			raw.terminate();
			return;
		}
		missedPongs += 1;
		raw.ping();
	}, WS_PING_INTERVAL_MS);
	return () => {
		clearInterval(timer);
		raw.off("pong", handlePong);
	};
}
