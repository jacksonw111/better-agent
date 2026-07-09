import { expect, it } from "vitest";
import {
	createInMemoryRelayStore,
	MAX_WINDOW,
	type RelayEvent,
} from "./relay-store";

const SECOND_ID = 2;
const THIRD_ID = 3;

it("append returns monotonically increasing ids and read replays them in order", async () => {
	const store = createInMemoryRelayStore();

	const { id: id1 } = await store.append("s1", "events", { n: 1 });
	const { id: id2 } = await store.append("s1", "events", { n: SECOND_ID });

	expect(id1).toBe(1);
	expect(id2).toBe(SECOND_ID);
	await expect(store.read("s1", "events", 0)).resolves.toEqual([
		{ id: 1, data: { n: 1 } },
		{ id: 2, data: { n: 2 } },
	]);
});

it("append is idempotent: the same idempotencyKey twice stores one event and returns the existing id", async () => {
	const store = createInMemoryRelayStore();

	const first = await store.append("s1", "events", { n: 1 }, "key-a");
	const second = await store.append("s1", "events", { n: 1 }, "key-a");

	expect(first).toEqual({ id: 1, isNew: true });
	expect(second).toEqual({ id: 1, isNew: false });
	await expect(store.read("s1", "events", 0)).resolves.toEqual([
		{ id: 1, data: { n: 1 } },
	]);
});

it("append with different idempotencyKeys stores two distinct events", async () => {
	const store = createInMemoryRelayStore();

	const first = await store.append("s1", "events", "a", "key-a");
	const second = await store.append("s1", "events", "b", "key-b");

	expect(first).toEqual({ id: 1, isNew: true });
	expect(second).toEqual({ id: SECOND_ID, isNew: true });
	await expect(store.read("s1", "events", 0)).resolves.toEqual([
		{ id: 1, data: "a" },
		{ id: SECOND_ID, data: "b" },
	]);
});

it("omitting idempotencyKey never dedupes: every call appends (matches pre-T1 behavior, used by the commands direction)", async () => {
	const store = createInMemoryRelayStore();

	const first = await store.append("s1", "commands", { same: true });
	const second = await store.append("s1", "commands", { same: true });

	expect(first).toEqual({ id: 1, isNew: true });
	expect(second).toEqual({ id: SECOND_ID, isNew: true });
	await expect(store.read("s1", "commands", 0)).resolves.toHaveLength(2);
});

it("read filters to ids strictly greater than afterId", async () => {
	const store = createInMemoryRelayStore();
	await store.append("s1", "events", "a");
	await store.append("s1", "events", "b");
	await store.append("s1", "events", "c");

	await expect(store.read("s1", "events", 1)).resolves.toEqual([
		{ id: 2, data: "b" },
		{ id: 3, data: "c" },
	]);
	await expect(store.read("s1", "events", THIRD_ID)).resolves.toEqual([]);
});

it("caps the replay window at MAX_WINDOW, dropping the oldest events", async () => {
	const store = createInMemoryRelayStore();
	const overflow = 10;
	const total = MAX_WINDOW + overflow;
	for (let i = 0; i < total; i++) {
		await store.append("s1", "events", i);
	}

	const events = await store.read("s1", "events", 0);
	expect(events).toHaveLength(MAX_WINDOW);
	expect(events[0]?.id).toBe(overflow + 1);
	expect(events.at(-1)?.id).toBe(total);
});

it("isolates ids and events between dirs and sessions", async () => {
	const store = createInMemoryRelayStore();
	await store.append("s1", "events", "e1");
	await store.append("s1", "commands", "c1");
	await store.append("s2", "events", "other-session");

	await expect(store.read("s1", "events", 0)).resolves.toEqual([
		{ id: 1, data: "e1" },
	]);
	await expect(store.read("s1", "commands", 0)).resolves.toEqual([
		{ id: 1, data: "c1" },
	]);
	await expect(store.read("s2", "events", 0)).resolves.toEqual([
		{ id: 1, data: "other-session" },
	]);
});

it("subscribe receives appended events live; unsubscribe stops further delivery", async () => {
	const store = createInMemoryRelayStore();
	const received: RelayEvent[] = [];
	const unsubscribe = store.subscribe("s1", "events", (event) => {
		received.push(event);
	});

	await store.append("s1", "events", "first");
	unsubscribe();
	await store.append("s1", "events", "second");

	expect(received).toEqual([{ id: 1, data: "first" }]);
});

it("subscribers are scoped to their own session/dir", async () => {
	const store = createInMemoryRelayStore();
	const eventsReceived: RelayEvent[] = [];
	const commandsReceived: RelayEvent[] = [];
	store.subscribe("s1", "events", (event) => eventsReceived.push(event));
	store.subscribe("s1", "commands", (event) => commandsReceived.push(event));

	await store.append("s1", "events", "e");
	await store.append("s1", "commands", "c");

	expect(eventsReceived).toEqual([{ id: 1, data: "e" }]);
	expect(commandsReceived).toEqual([{ id: 1, data: "c" }]);
});
