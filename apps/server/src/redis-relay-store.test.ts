import {
	MAX_WINDOW,
	type RelayEvent,
	WINDOW_TTL_SEC,
} from "@better-agent/agent/bridge/relay-store";
import RedisMock from "ioredis-mock";
import { expect, it } from "vitest";
import { createRedisRelayStore, SEQ_TTL_SEC } from "./redis-relay-store";

// ioredis-mock v8 shares a single in-process data store (and pub/sub bus)
// across every instance created with `new RedisMock()` — so each test below
// uses its own session id to avoid cross-test key collisions.
const WAIT_MS = 5;
const SECOND_ID = 2;
const THIRD_ID = 3;
function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

it("append returns monotonically increasing ids and read replays them in order", async () => {
	const store = createRedisRelayStore(new RedisMock());

	const { id: id1 } = await store.append("append-read", "events", { n: 1 });
	const { id: id2 } = await store.append("append-read", "events", {
		n: SECOND_ID,
	});

	expect(id1).toBe(1);
	expect(id2).toBe(SECOND_ID);
	await expect(store.read("append-read", "events", 0)).resolves.toEqual([
		{ id: 1, data: { n: 1 } },
		{ id: 2, data: { n: 2 } },
	]);
});

it("append is idempotent: the same idempotencyKey twice stores one event and returns the existing id", async () => {
	const store = createRedisRelayStore(new RedisMock());

	const first = await store.append("idemp-dup", "events", { n: 1 }, "key-a");
	const second = await store.append("idemp-dup", "events", { n: 1 }, "key-a");

	expect(first).toEqual({ id: 1, isNew: true });
	expect(second).toEqual({ id: 1, isNew: false });
	await expect(store.read("idemp-dup", "events", 0)).resolves.toEqual([
		{ id: 1, data: { n: 1 } },
	]);
});

it("append with different idempotencyKeys stores two distinct events", async () => {
	const store = createRedisRelayStore(new RedisMock());

	const first = await store.append("idemp-distinct", "events", "a", "key-a");
	const second = await store.append("idemp-distinct", "events", "b", "key-b");

	expect(first).toEqual({ id: 1, isNew: true });
	expect(second).toEqual({ id: SECOND_ID, isNew: true });
	await expect(store.read("idemp-distinct", "events", 0)).resolves.toEqual([
		{ id: 1, data: "a" },
		{ id: SECOND_ID, data: "b" },
	]);
});

it("read filters to ids strictly greater than afterId", async () => {
	const store = createRedisRelayStore(new RedisMock());
	await store.append("after-id", "events", "a");
	await store.append("after-id", "events", "b");
	await store.append("after-id", "events", "c");

	await expect(store.read("after-id", "events", 1)).resolves.toEqual([
		{ id: 2, data: "b" },
		{ id: 3, data: "c" },
	]);
	await expect(store.read("after-id", "events", THIRD_ID)).resolves.toEqual([]);
});

it("readTail returns only the last N events, in id order", async () => {
	const store = createRedisRelayStore(new RedisMock());
	await store.append("tail-read", "events", "a");
	await store.append("tail-read", "events", "b");
	await store.append("tail-read", "events", "c");

	await expect(store.readTail("tail-read", "events", 2)).resolves.toEqual([
		{ id: SECOND_ID, data: "b" },
		{ id: THIRD_ID, data: "c" },
	]);
	await expect(store.readTail("tail-read", "events", 10)).resolves.toEqual([
		{ id: 1, data: "a" },
		{ id: SECOND_ID, data: "b" },
		{ id: THIRD_ID, data: "c" },
	]);
	await expect(store.readTail("tail-read", "events", 0)).resolves.toEqual([]);
	await expect(store.readTail("tail-empty", "events", 5)).resolves.toEqual([]);
});

it("caps the replay window at MAX_WINDOW, dropping the oldest events", async () => {
	const store = createRedisRelayStore(new RedisMock());
	const overflow = 10;
	const total = MAX_WINDOW + overflow;
	for (let i = 0; i < total; i++) {
		await store.append("window-cap", "events", i);
	}

	const events = await store.read("window-cap", "events", 0);
	expect(events).toHaveLength(MAX_WINDOW);
	expect(events[0]?.id).toBe(overflow + 1);
	expect(events.at(-1)?.id).toBe(total);
});

it("isolates ids and events between dirs and sessions", async () => {
	const store = createRedisRelayStore(new RedisMock());
	await store.append("isolation-1", "events", "e1");
	await store.append("isolation-1", "commands", "c1");
	await store.append("isolation-2", "events", "other-session");

	await expect(store.read("isolation-1", "events", 0)).resolves.toEqual([
		{ id: 1, data: "e1" },
	]);
	await expect(store.read("isolation-1", "commands", 0)).resolves.toEqual([
		{ id: 1, data: "c1" },
	]);
	await expect(store.read("isolation-2", "events", 0)).resolves.toEqual([
		{ id: 1, data: "other-session" },
	]);
});

it("subscribe receives appended events live (cross-connection); unsubscribe stops delivery", async () => {
	const redisA = new RedisMock();
	const redisB = new RedisMock();
	const subscriberStore = createRedisRelayStore(redisA);
	const appenderStore = createRedisRelayStore(redisB);
	const received: RelayEvent[] = [];

	const unsubscribe = subscriberStore.subscribe(
		"live-push",
		"events",
		(event) => {
			received.push(event);
		}
	);
	await wait(WAIT_MS);

	await appenderStore.append("live-push", "events", "first");
	await wait(WAIT_MS);
	unsubscribe();
	await appenderStore.append("live-push", "events", "second");
	await wait(WAIT_MS);

	expect(received).toEqual([{ id: 1, data: "first" }]);
});

it("read returns ids in ascending order even when RPUSH landed them out of order", async () => {
	// appendEvent's INCR (id allocation) and RPUSH (list insertion) are
	// separate round trips, so two concurrent appends can race and land in
	// the list out of id order. Simulate that race by RPUSHing directly,
	// bypassing store.append(), with the higher id pushed first.
	const redis = new RedisMock();
	const store = createRedisRelayStore(redis);
	const key = "bridge:out-of-order:events";

	await redis.rpush(key, JSON.stringify({ id: SECOND_ID, data: "b" }));
	await redis.rpush(key, JSON.stringify({ id: 1, data: "a" }));
	await redis.rpush(key, JSON.stringify({ id: THIRD_ID, data: "c" }));

	await expect(store.read("out-of-order", "events", 0)).resolves.toEqual([
		{ id: 1, data: "a" },
		{ id: SECOND_ID, data: "b" },
		{ id: THIRD_ID, data: "c" },
	]);
});

it("gives the seq counter a TTL far longer than the window list, refreshed on every append", async () => {
	const redis = new RedisMock();
	const store = createRedisRelayStore(redis);

	await store.append("seq-ttl", "events", "a");
	await expect(redis.ttl("bridge:seq-ttl:events:seq")).resolves.toBe(
		SEQ_TTL_SEC
	);
	await expect(redis.ttl("bridge:seq-ttl:events")).resolves.toBe(
		WINDOW_TTL_SEC
	);
	expect(SEQ_TTL_SEC).toBeGreaterThan(WINDOW_TTL_SEC);
});

it("keeps ids monotonic across a simulated window-list expiry (seq key outlives it)", async () => {
	const redis = new RedisMock();
	const store = createRedisRelayStore(redis);

	const { id: id1 } = await store.append("seq-survives-expiry", "events", "a");
	// Simulate the 900s window list TTL elapsing while the much-longer-lived
	// seq key survives: delete only the list key, leaving the counter intact.
	await redis.del("bridge:seq-survives-expiry:events");
	const { id: id2 } = await store.append("seq-survives-expiry", "events", "b");

	expect(id2).toBe(id1 + 1);
});

it("subscribers are scoped to their own session/dir channel", async () => {
	const redisA = new RedisMock();
	const redisB = new RedisMock();
	const subscriberStore = createRedisRelayStore(redisA);
	const appenderStore = createRedisRelayStore(redisB);
	const eventsReceived: RelayEvent[] = [];
	const commandsReceived: RelayEvent[] = [];

	subscriberStore.subscribe("channel-scope", "events", (event) =>
		eventsReceived.push(event)
	);
	subscriberStore.subscribe("channel-scope", "commands", (event) =>
		commandsReceived.push(event)
	);
	await wait(WAIT_MS);

	await appenderStore.append("channel-scope", "events", "e");
	await appenderStore.append("channel-scope", "commands", "c");
	await wait(WAIT_MS);

	expect(eventsReceived).toEqual([{ id: 1, data: "e" }]);
	expect(commandsReceived).toEqual([{ id: 1, data: "c" }]);
});
