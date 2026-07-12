import { expect, it } from "vitest";
import type { StreamEvent } from "./bridge-events";
import {
	type AssistantTurn,
	type BridgeTurn,
	foldEventsToTurns,
} from "./bridge-turns";

// Split out of bridge-turns.test.ts purely to keep that file under the
// repo's 300-line limit (the whitelist-semantics fix on `foldStatus` added
// coverage that pushed it over) — mirrors bridge-turns-message-merge.test.ts
// et al.'s identical split for the same gate.

const ev = (id: number, event: StreamEvent["event"]): StreamEvent => ({
	id,
	event,
});

const asAssistant = (turn: BridgeTurn): AssistantTurn => {
	if (turn.kind !== "assistant") {
		throw new Error(`expected an assistant turn, got ${turn.kind}`);
	}
	return turn;
};

it("hides session_ready/turn_usage/usage_update/command_catalog AND does not let them fragment the assistant bubble", () => {
	const turns = foldEventsToTurns([
		ev(1, { kind: "output", text: "first" }),
		ev(2, {
			kind: "status",
			status: "session_ready",
			detail: { model: "claude-opus-4-6" },
		}),
		ev(3, { kind: "output", text: "second" }),
		ev(4, {
			kind: "status",
			status: "turn_usage",
			detail: { costUsd: 0.01 },
		}),
		ev(5, {
			kind: "status",
			status: "command_catalog",
			detail: { commands: [{ name: "compact" }] },
		}),
		ev(6, { kind: "status", status: "usage_update", detail: { used: 10 } }),
		ev(7, { kind: "status", status: "restarting" }),
	]);
	// Hidden non-boundary heartbeats interleave mid-stream (opencode fires one
	// per session/update) and must NOT split a reply: the two outputs merge
	// into ONE bubble. Only the curated, whitelisted notice status
	// ("restarting") closes it + shows as a turn.
	expect(turns.map((t) => t.kind)).toEqual(["assistant", "status"]);
	expect(asAssistant(turns[0]).blocks).toEqual([
		{ kind: "text", text: "firstsecond" },
	]);
});

it("does not let an unknown adapter status (not in any curated list) fragment the assistant bubble", () => {
	// Newer opencode builds interleave sessionUpdate kinds this codebase
	// doesn't know about yet (e.g. "current_mode_update") between
	// agent_message_chunks. Regression test for the sentence-by-sentence
	// bug: an unrecognized status must be silently absorbed — no status
	// turn, and it must not close the in-flight assistant bubble either.
	const turns = foldEventsToTurns([
		ev(1, { kind: "output", text: "first" }),
		ev(2, { kind: "status", status: "current_mode_update" }),
		ev(3, { kind: "output", text: "second" }),
	]);
	expect(turns.map((t) => t.kind)).toEqual(["assistant"]);
	expect(asAssistant(turns[0]).blocks).toEqual([
		{ kind: "text", text: "firstsecond" },
	]);
});

it("renders a formerly-dropped CLI warning status (event_truncated) as its own status turn again", () => {
	// Task 13 addendum: event_truncated (truncate-event.ts's oversized-event
	// marker) fell out of both curated lists when foldStatus flipped to a
	// whitelist (commit 6e73cad) and was silently absorbed. It's a CLI-origin
	// warning the user must see, so it was re-admitted to STATUS_NOTICE_KINDS
	// via status-line.tsx's STATUS_NOTICES — this asserts it closes the
	// bubble and renders as a status turn, same as any other notice kind.
	const turns = foldEventsToTurns([
		ev(1, { kind: "output", text: "first" }),
		ev(2, { kind: "status", status: "event_truncated" }),
		ev(3, { kind: "output", text: "second" }),
	]);
	expect(turns.map((t) => t.kind)).toEqual([
		"assistant",
		"status",
		"assistant",
	]);
	expect(asAssistant(turns[0]).blocks).toEqual([
		{ kind: "text", text: "first" },
	]);
	expect(asAssistant(turns[2]).blocks).toEqual([
		{ kind: "text", text: "second" },
	]);
});

it("hides status_snapshot (the on-demand getStatus reply, consumed off the raw feed by use-bridge-feed.ts BEFORE folding) without fragmenting the assistant bubble", () => {
	// Task 13 addendum: status_snapshot is a hidden, non-boundary status like
	// SESSION_READY_STATUS/TURN_USAGE_STATUS — it must not render a status
	// turn nor close the in-flight assistant bubble.
	const turns = foldEventsToTurns([
		ev(1, { kind: "output", text: "first" }),
		ev(2, {
			kind: "status",
			status: "status_snapshot",
			detail: { model: "x" },
		}),
		ev(3, { kind: "output", text: "second" }),
	]);
	expect(turns.map((t) => t.kind)).toEqual(["assistant"]);
	expect(asAssistant(turns[0]).blocks).toEqual([
		{ kind: "text", text: "firstsecond" },
	]);
});
