// Shared by ws-duplex.test.ts and run-bridge-session-duplex.test.ts — a fake
// `WsLike` socket (and a `WsFactory` that mints a fresh one per call, so
// tests can drive a reconnect) that never opens a real connection. Split out
// purely so both spec files can reuse the exact same fixture instead of
// duplicating it (mirrors adapters/approvals-test-helpers.ts).

import type {
	ClientFrame,
	ServerFrame,
} from "@better-agent/api/bridge/ws-session";
import type { WsEventMap, WsFactory, WsLike } from "./ws-duplex-socket";

/** A fully in-memory `WsLike` — `send` records the parsed frame instead of
 * writing to a socket, and `emitOpen`/`emitMessage`/`emitClose`/`emitError`
 * let a test drive its lifecycle deterministically. */
export class FakeSocket implements WsLike {
	closedByClient = false;
	readonly headers: Record<string, string>;
	readonly sent: ClientFrame[] = [];
	readonly url: string;

	private readonly listeners: { [E in keyof WsEventMap]: WsEventMap[E][] } = {
		close: [],
		error: [],
		message: [],
		open: [],
	};

	constructor(url: string, headers: Record<string, string>) {
		this.url = url;
		this.headers = headers;
	}

	on<E extends keyof WsEventMap>(event: E, listener: WsEventMap[E]): void {
		this.listeners[event].push(listener);
	}

	send(data: string): void {
		this.sent.push(JSON.parse(data) as ClientFrame);
	}

	close(): void {
		this.closedByClient = true;
	}

	emitOpen(): void {
		for (const listener of this.listeners.open) {
			listener();
		}
	}

	emitMessage(frame: ServerFrame): void {
		const raw = JSON.stringify(frame);
		for (const listener of this.listeners.message) {
			listener(raw);
		}
	}

	emitClose(code = 1006, reason: unknown = "closed"): void {
		for (const listener of this.listeners.close) {
			listener(code, reason);
		}
	}

	emitError(error: unknown = new Error("boom")): void {
		for (const listener of this.listeners.error) {
			listener(error);
		}
	}
}

/** Mints a new `FakeSocket` on every call (mirroring a real `WsFactory`
 * reconnecting) and keeps every one it ever created, in order — so a test
 * can inspect `sockets[0]` for the initial connection and `sockets[1]` for
 * the first reconnect, etc. */
export function createFakeWsFactory(): {
	factory: WsFactory;
	sockets: FakeSocket[];
} {
	const sockets: FakeSocket[] = [];
	const factory: WsFactory = (url, headers) => {
		const socket = new FakeSocket(url, headers);
		sockets.push(socket);
		return socket;
	};
	return { factory, sockets };
}
