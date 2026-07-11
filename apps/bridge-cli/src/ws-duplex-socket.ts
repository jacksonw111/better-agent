// R0-T2 (local-agent transport refactor): the minimal socket shape
// ws-duplex.ts/ws-duplex-reconnect.ts drive, plus the injectable factory that
// creates one. Node's built-in (undici) WebSocket can't set request headers,
// so the real factory below uses the `ws` package instead — but every OTHER
// file in this feature only ever talks to the narrow `WsLike` shape, never
// `ws` directly, which is what lets tests inject a fake socket (no real
// server, no real network) per R0-T2's test plan.

import WebSocket from "ws";

/** The listener signature for each event `WsLike.on` supports — a plain
 * (non-overloaded) generic `on<E>` keeps both the real `ws` cast below and
 * `ws-duplex-test-helpers.ts`'s fake implementation simple: TypeScript's
 * overload-vs-implementation compatibility check gets needlessly strict once
 * a method has more than one call signature. */
export interface WsEventMap {
	close: (code: number, reason: unknown) => void;
	error: (error: unknown) => void;
	message: (data: unknown) => void;
	open: () => void;
}

/** The subset of a `ws` client socket's event surface the duplex channel
 * needs. Deliberately narrower than `@types/ws`'s full `WebSocket` so a test
 * fake only has to implement four events. */
export interface WsLike {
	close(): void;
	on<E extends keyof WsEventMap>(event: E, listener: WsEventMap[E]): void;
	send(data: string): void;
}

/** Opens (but does not await the connection of) a `WsLike` socket to `url`
 * with `headers` attached to the upgrade request — injectable so tests never
 * need a real server (see ws-duplex.test.ts). */
export type WsFactory = (
	url: string,
	headers: Record<string, string>
) => WsLike;

/** Production `WsFactory`: a real `ws` client socket, sending `headers` on
 * the WS upgrade request (the one thing Node's native `WebSocket` can't do,
 * per this module's doc comment). */
export const defaultWsFactory: WsFactory = (url, headers) =>
	new WebSocket(url, { headers }) as unknown as WsLike;
