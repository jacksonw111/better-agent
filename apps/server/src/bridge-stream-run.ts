import type { RelayEvent } from "@better-agent/agent/bridge/relay-store";

// C3 loss fix: the SSE observe route used to swallow failed writes
// (`writeSSE().catch(() => undefined)`) — a half-dead connection kept its
// subscription while every event silently vanished. Extracted here (thin
// enough for app.ts to stay a transport shim, testable without HTTP): ANY
// failed write now tears the stream down — unsubscribe + resolve, which ends
// the hono streamSSE body — so the browser's EventSource reconnects with
// Last-Event-ID and replays the gap from the relay window instead of losing it.

/** The writes/lifecycle hooks of one SSE response, as promised operations so
 * a failure is observable (hono's stream.writeSSE/write both reject). */
export interface BridgeStreamIo {
	onAbort: (handler: () => void) => void;
	writeEvent: (event: RelayEvent) => Promise<void>;
	writePing: () => Promise<void>;
}

export interface RunBridgeStreamArgs {
	heartbeatMs: number;
	io: BridgeStreamIo;
	/** Opens the live relay subscription (observeBridgeEvents in app.ts);
	 * returns its unsubscribe. */
	subscribe: (onEvent: (event: RelayEvent) => void) => () => void;
}

/** Pumps relay events (plus keep-alive pings) into one SSE response until the
 * client aborts OR a write fails; resolves once torn down. */
export function runBridgeEventStream(args: RunBridgeStreamArgs): Promise<void> {
	const { heartbeatMs, io, subscribe } = args;
	return new Promise<void>((resolve) => {
		let finished = false;
		let unsubscribe = () => {
			// replaced right below, before anything can call finish()
		};
		const heartbeat = setInterval(() => {
			io.writePing().catch(finish);
		}, heartbeatMs);
		function finish(): void {
			if (finished) {
				return;
			}
			finished = true;
			clearInterval(heartbeat);
			unsubscribe();
			resolve();
		}
		unsubscribe = subscribe((event) => {
			io.writeEvent(event).catch(finish);
		});
		io.onAbort(finish);
	});
}
