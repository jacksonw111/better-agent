import { describe, expect, it } from "vitest";
import type { MessageEvent } from "./bridge-events";
import { feedReducer, initialFeedState } from "./use-bridge-feed";

const statusRaw = (n: number) => ({
	id: n,
	data: { kind: "status", status: `step-${n}` },
});

describe("feedReducer localEcho", () => {
	it("appends a user message with a fresh negative id", () => {
		const state = feedReducer(initialFeedState, {
			type: "localEcho",
			text: "hello agent",
		});
		expect(state.events).toHaveLength(1);
		const [entry] = state.events;
		expect(entry.id).toBe(-1);
		const event = entry.event as MessageEvent;
		expect(event).toEqual({
			kind: "message",
			role: "user",
			text: "hello agent",
		});
		expect(event.thinking).toBeUndefined();
	});

	it("gives two echoes distinct, decrementing ids", () => {
		const first = feedReducer(initialFeedState, {
			type: "localEcho",
			text: "one",
		});
		const second = feedReducer(first, { type: "localEcho", text: "two" });
		expect(second.events.map((e) => e.id)).toEqual([-1, -2]);
		expect(second.nextLocalId).toBe(-3);
	});

	it("leaves maxSeenId untouched and never collides with server merges", () => {
		const withServer = feedReducer(initialFeedState, {
			type: "events",
			events: [statusRaw(1), statusRaw(2)],
		});
		expect(withServer.maxSeenId).toBe(2);

		const echoed = feedReducer(withServer, {
			type: "localEcho",
			text: "user line",
		});
		// The echo does not move the server high-water mark…
		expect(echoed.maxSeenId).toBe(2);
		// …and a subsequent server event still merges normally.
		const more = feedReducer(echoed, {
			type: "events",
			events: [statusRaw(3)],
		});
		expect(more.maxSeenId).toBe(3);
		expect(more.events.map((e) => e.id)).toEqual([1, 2, -1, 3]);
	});
});

const userMsgRaw = (id: number, text: string) => ({
	id,
	data: { kind: "message", role: "user", text },
});

describe("feedReducer echo dedupe", () => {
	it("drops the optimistic echo once its server-persisted twin arrives", () => {
		const echoed = feedReducer(initialFeedState, {
			type: "localEcho",
			text: "hello agent",
		});
		expect(echoed.events.map((e) => e.id)).toEqual([-1]);

		// The CLI persists the same line; it comes back through history/live.
		const merged = feedReducer(echoed, {
			type: "events",
			events: [userMsgRaw(1, "hello agent")],
		});
		// Only the server copy survives — no duplicate user line.
		expect(merged.events.map((e) => e.id)).toEqual([1]);
	});

	it("keeps an echo that has no server twin yet", () => {
		const echoed = feedReducer(initialFeedState, {
			type: "localEcho",
			text: "not acked",
		});
		const merged = feedReducer(echoed, {
			type: "events",
			events: [userMsgRaw(1, "a different line")],
		});
		expect(merged.events.map((e) => e.id)).toEqual([-1, 1]);
	});
});

// R3-T1 Part A: pi's queue_update passthrough is folded into FeedState the
// same incremental way as the other curated status kinds (see
// bridge-queue-status.ts / nextStatusDetails).
describe("feedReducer queue_update folding", () => {
	const queueUpdateRaw = (id: number, detail: Record<string, unknown>) => ({
		id,
		data: { kind: "status", status: "queue_update", detail },
	});

	it("starts null before any queue_update has arrived", () => {
		expect(initialFeedState.queueUpdate).toBeNull();
	});

	it("folds a well-formed queue_update into state.queueUpdate", () => {
		const state = feedReducer(initialFeedState, {
			type: "events",
			events: [queueUpdateRaw(1, { steering: ["a"], followUp: ["b", "c"] })],
		});
		expect(state.queueUpdate).toEqual({ queuedCount: 3 });
	});

	it("keeps the latest queue_update, ignoring an earlier one in the same batch", () => {
		const state = feedReducer(initialFeedState, {
			type: "events",
			events: [
				queueUpdateRaw(1, { steering: ["a"] }),
				queueUpdateRaw(2, { steering: ["a", "b"], followUp: ["c"] }),
			],
		});
		expect(state.queueUpdate).toEqual({ queuedCount: 3 });
	});
});

// R5-T2: command_catalog is folded into FeedState the same incremental way
// as the other curated status kinds — the "/" picker's live command source
// (see terminal-body.tsx's commandNamesFor).
describe("feedReducer command_catalog folding", () => {
	const commandCatalogRaw = (
		id: number,
		commands: { name: string; description?: string }[]
	) => ({
		id,
		data: { kind: "status", status: "command_catalog", detail: { commands } },
	});

	it("starts null before any command_catalog has arrived", () => {
		expect(initialFeedState.commandCatalog).toBeNull();
	});

	it("folds a well-formed command_catalog into state.commandCatalog", () => {
		const state = feedReducer(initialFeedState, {
			type: "events",
			events: [
				commandCatalogRaw(1, [
					{ name: "compact", description: "Compact the conversation" },
				]),
			],
		});
		expect(state.commandCatalog).toEqual({
			commands: [{ name: "compact", description: "Compact the conversation" }],
		});
	});

	it("keeps the latest command_catalog, replacing (not merging) an earlier one — mirrors claude-code's commands_changed push", () => {
		const state = feedReducer(initialFeedState, {
			type: "events",
			events: [
				commandCatalogRaw(1, [{ name: "compact" }]),
				commandCatalogRaw(2, [{ name: "compact" }, { name: "review" }]),
			],
		});
		expect(state.commandCatalog?.commands.map((c) => c.name)).toEqual([
			"compact",
			"review",
		]);
	});
});

// fix-approval-replay: the CLI persists an approval RESOLUTION event (kind
// "approval" + answeredOptionId) right after the user answers — the answer
// command itself only lives in the relay's TTL'd commands window, so this
// event is what lets a reload/replay reconstruct "answered with this option".
describe("feedReducer approval resolution folding", () => {
	const approvalReqRaw = (id: number, requestId: string) => ({
		id,
		data: {
			kind: "approval",
			requestId,
			title: "Run command?",
			options: [{ id: "allow", label: "Allow" }],
		},
	});
	const resolutionRaw = (id: number, requestId: string, optionId: string) => ({
		id,
		data: {
			kind: "approval",
			answeredOptionId: optionId,
			options: [],
			requestId,
			title: "Answered",
		},
	});

	it("folds a replayed resolution event into the answered map", () => {
		const state = feedReducer(initialFeedState, {
			type: "events",
			events: [approvalReqRaw(1, "req-1"), resolutionRaw(2, "req-1", "allow")],
		});
		expect(state.answered).toEqual({ "req-1": "allow" });
	});

	it("leaves the answered map untouched for an ordinary approval request", () => {
		const state = feedReducer(initialFeedState, {
			type: "events",
			events: [approvalReqRaw(1, "req-1")],
		});
		expect(state.answered).toEqual({});
	});
});

describe("feedReducer anti-leak (raw RPC envelope)", () => {
	it("drops a wrapped oRPC {json:{ok:true}} envelope instead of rendering it", () => {
		const state = feedReducer(initialFeedState, {
			type: "events",
			events: [{ id: 1, data: { json: { ok: true } } }],
		});
		// parseNormalizedEvent has no recognized `kind`, so nothing renders…
		expect(state.events).toHaveLength(0);
		// …but the high-water mark still advances past the dropped frame.
		expect(state.maxSeenId).toBe(1);
	});

	it("drops a bare {ok:true} response the same way", () => {
		const state = feedReducer(initialFeedState, {
			type: "events",
			events: [{ id: 1, data: { ok: true } }],
		});
		expect(state.events).toHaveLength(0);
		expect(state.maxSeenId).toBe(1);
	});
});
