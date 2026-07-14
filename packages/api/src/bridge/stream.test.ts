import type { RelayEvent, RelayStore } from "@better-agent/agent/ports";
import { expect, it } from "vitest";
import type { Context } from "../context";
import { observeBridgeEvents, resolveStreamAuth } from "./stream";

function flush(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

function createControllableRelayStore() {
	const listeners = new Set<(event: RelayEvent) => void>();
	let resolveRead: ((events: RelayEvent[]) => void) | null = null;
	const store: RelayStore = {
		append: () => Promise.resolve({ id: 0, isNew: true }),
		readTail: () => Promise.resolve([]),
		read: () =>
			new Promise((resolve) => {
				resolveRead = resolve;
			}),
		subscribe: (_sessionId, _dir, onEvent) => {
			listeners.add(onEvent);
			return () => listeners.delete(onEvent);
		},
	};
	return {
		store,
		emit(event: RelayEvent) {
			for (const listener of listeners) {
				listener(event);
			}
		},
		finishRead(events: RelayEvent[]) {
			resolveRead?.(events);
		},
	};
}

it("delivers replay events before any live event that arrived mid-replay", async () => {
	const { store, emit, finishRead } = createControllableRelayStore();
	const received: number[] = [];
	observeBridgeEvents({
		relayStore: store,
		sessionId: "s1",
		afterId: 0,
		onEvent: (event) => received.push(event.id),
	});

	// A live push lands while the replay read() is still in flight.
	emit({ id: 3, data: "c" });
	expect(received).toEqual([]);

	finishRead([
		{ id: 1, data: "a" },
		{ id: 2, data: "b" },
	]);
	await flush();

	expect(received).toEqual([1, 2, 3]);
});

it("dedupes an event delivered by both replay and live push", async () => {
	const { store, emit, finishRead } = createControllableRelayStore();
	const received: number[] = [];
	observeBridgeEvents({
		relayStore: store,
		sessionId: "s1",
		afterId: 0,
		onEvent: (event) => received.push(event.id),
	});

	emit({ id: 2, data: "dup" });
	finishRead([
		{ id: 1, data: "a" },
		{ id: 2, data: "b" },
	]);
	await flush();

	expect(received).toEqual([1, 2]);
});

it("delivers post-replay live events immediately, in arrival order", async () => {
	const { store, emit, finishRead } = createControllableRelayStore();
	const received: number[] = [];
	observeBridgeEvents({
		relayStore: store,
		sessionId: "s1",
		afterId: 0,
		onEvent: (event) => received.push(event.id),
	});

	finishRead([]);
	await flush();

	emit({ id: 4, data: "d" });
	emit({ id: 5, data: "e" });
	expect(received).toEqual([4, 5]);
});

it("stops delivering events once unsubscribed", async () => {
	const { store, emit, finishRead } = createControllableRelayStore();
	const received: number[] = [];
	const unsubscribe = observeBridgeEvents({
		relayStore: store,
		sessionId: "s1",
		afterId: 0,
		onEvent: (event) => received.push(event.id),
	});

	finishRead([]);
	await flush();
	unsubscribe();

	emit({ id: 6, data: "f" });
	expect(received).toEqual([]);
});

const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;

function fakeContext(
	authedUser: { blocked?: boolean; id: string } | null,
	sessionOwner: string | null
): Context {
	return {
		services: {
			stores: {
				bridgeSession: {
					get: (id: string) =>
						Promise.resolve(
							sessionOwner
								? {
										id,
										userId: sessionOwner,
										tokenId: "t1",
										agentKind: "claude-code" as const,
										label: null,
										status: "active" as const,
										createdAt: new Date(),
										lastSeenAt: new Date(),
									}
								: null
						),
				},
			},
		},
		authedUser,
	} as unknown as Context;
}

it("resolveStreamAuth rejects an unauthenticated caller", async () => {
	const context = fakeContext(null, null);
	const result = await resolveStreamAuth(context, "s1");
	expect(result).toEqual({ ok: false, status: HTTP_UNAUTHORIZED });
});

it("resolveStreamAuth rejects a non-owner (NOT_FOUND semantics)", async () => {
	const context = fakeContext({ id: "alice" }, "bob");
	const result = await resolveStreamAuth(context, "s1");
	expect(result).toEqual({ ok: false, status: HTTP_NOT_FOUND });
});

it("resolveStreamAuth rejects a missing session", async () => {
	const context = fakeContext({ id: "alice" }, null);
	const result = await resolveStreamAuth(context, "s1");
	expect(result).toEqual({ ok: false, status: HTTP_NOT_FOUND });
});

it("resolveStreamAuth accepts the owner", async () => {
	const context = fakeContext({ id: "alice" }, "alice");
	const result = await resolveStreamAuth(context, "s1");
	expect(result).toEqual({ ok: true, userId: "alice" });
});

it("resolveStreamAuth rejects a blocked owner (mirrors requireActiveUser)", async () => {
	const context = fakeContext({ blocked: true, id: "alice" }, "alice");
	const result = await resolveStreamAuth(context, "s1");
	expect(result).toEqual({ ok: false, status: HTTP_FORBIDDEN });
});
