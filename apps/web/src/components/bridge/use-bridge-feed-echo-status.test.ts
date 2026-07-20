import { expect, it } from "vitest";
import { foldEventsToTurns } from "./bridge-turns";
import {
	type FeedState,
	feedReducer,
	initialFeedState,
} from "./use-bridge-feed";

// fix-send-outbox: the echoed line's delivery state — the half of the fix that
// makes a lost message VISIBLE instead of letting it pass for a sent one.

function echoed(state: FeedState, sendKey: string, text = "hi"): FeedState {
	return feedReducer(state, { type: "localEcho", text, sendKey });
}

function firstEchoEvent(state: FeedState) {
	const entry = state.events[0];
	return entry?.event.kind === "message" ? entry.event : null;
}

it("marks a keyed local echo as sending the moment it is queued", () => {
	const state = echoed(initialFeedState, "key-1");

	expect(firstEchoEvent(state)).toMatchObject({
		role: "user",
		sendKey: "key-1",
		sendStatus: "sending",
		text: "hi",
	});
	expect(state.pendingEchoes).toBe(1);
});

it("leaves an unkeyed echo exactly as it was before the outbox", () => {
	const state = feedReducer(initialFeedState, {
		type: "localEcho",
		text: "hi",
	});

	expect(state.events[0]?.event).toEqual({
		kind: "message",
		role: "user",
		text: "hi",
	});
});

it("flips the echo to failed when the outbox exhausts its retries", () => {
	let state = echoed(initialFeedState, "key-1");
	state = feedReducer(state, {
		type: "echoStatus",
		key: "key-1",
		status: "failed",
	});

	expect(firstEchoEvent(state)?.sendStatus).toBe("failed");
});

it("marks the echo sent on delivery, leaving it for the persisted twin to strip", () => {
	let state = echoed(initialFeedState, "key-1");
	state = feedReducer(state, {
		type: "echoStatus",
		key: "key-1",
		status: "sent",
	});
	expect(firstEchoEvent(state)?.sendStatus).toBe("sent");

	// The CLI's persisted copy of the same line arrives: the echo is cancelled,
	// so the message is never rendered twice (the pre-existing dedupe).
	state = feedReducer(state, {
		type: "events",
		events: [{ id: 1, data: { kind: "message", role: "user", text: "hi" } }],
	});
	expect(state.events).toHaveLength(1);
	expect(state.events[0]?.id).toBe(1);
	expect(state.pendingEchoes).toBe(0);
});

it("removes the echo — and its pending count — when the user discards it", () => {
	let state = echoed(initialFeedState, "key-1");
	state = feedReducer(state, {
		type: "echoStatus",
		key: "key-1",
		status: "discarded",
	});

	expect(state.events).toEqual([]);
	expect(state.pendingEchoes).toBe(0);
});

it("ignores a status for an echo that is no longer in the feed", () => {
	const state = echoed(initialFeedState, "key-1");
	const next = feedReducer(state, {
		type: "echoStatus",
		key: "other-key",
		status: "failed",
	});

	expect(next).toBe(state);
});

it("only touches its own echo when several sends are queued", () => {
	let state = echoed(initialFeedState, "key-1", "first");
	state = echoed(state, "key-2", "second");
	state = feedReducer(state, {
		type: "echoStatus",
		key: "key-2",
		status: "failed",
	});

	const statuses = state.events.map((entry) =>
		entry.event.kind === "message" ? entry.event.sendStatus : null
	);
	expect(statuses).toEqual(["sending", "failed"]);
});

it("carries the send state through the turn fold onto the user turn", () => {
	let state = echoed(initialFeedState, "key-1");
	state = feedReducer(state, {
		type: "echoStatus",
		key: "key-1",
		status: "failed",
	});

	expect(foldEventsToTurns(state.events)).toEqual([
		{
			id: -1,
			kind: "user",
			sendKey: "key-1",
			sendStatus: "failed",
			text: "hi",
		},
	]);
});

it("folds an ordinary server user message with no send fields at all", () => {
	const state = feedReducer(initialFeedState, {
		type: "events",
		events: [{ id: 1, data: { kind: "message", role: "user", text: "hi" } }],
	});

	expect(foldEventsToTurns(state.events)).toEqual([
		{ id: 1, kind: "user", text: "hi" },
	]);
});
