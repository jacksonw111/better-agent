// R1-T1: an assistant reply must stay ONE turn across text→tool→text — the
// structural bug was `finalizeAssistantMessage` nulling `state.current` on
// every message final, so the NEXT tool event opened a brand-new turn
// ("Run command" rendering as its own card instead of part of the reply).
// See bridge-assistant-merge.ts for the fix (the turn stays open; only the
// text accumulation closes). Split out of bridge-turns.test.ts to keep that
// file under the repo's 300-line limit.

import { expect, it } from "vitest";
import type { StreamEvent } from "./bridge-events";
import {
	type AssistantTurn,
	type BridgeTurn,
	foldEventsToTurns,
} from "./bridge-turns";

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

it("keeps a text→tool→text reply as ONE turn with three blocks, not three turns", () => {
	const turns = foldEventsToTurns([
		ev(1, { kind: "message", role: "assistant", text: "Let me check." }),
		ev(2, {
			kind: "tool",
			id: "t1",
			name: "shell",
			input: { cmd: "ls" },
			status: "started",
		}),
		ev(3, {
			kind: "tool",
			id: "t1",
			name: "shell",
			status: "completed",
			output: "file.txt",
		}),
		ev(4, { kind: "message", role: "assistant", text: "Found it." }),
	]);
	expect(turns).toHaveLength(1);
	const assistant = asAssistant(turns[0]);
	expect(assistant.blocks.map((b) => b.kind)).toEqual(["text", "tool", "text"]);
	expect(assistant.blocks[0]).toEqual({ kind: "text", text: "Let me check." });
	expect(assistant.blocks[2]).toEqual({ kind: "text", text: "Found it." });
});

it("splits into two turns when a genuine turn boundary (turn_completed) sits between two messages", () => {
	const turns = foldEventsToTurns([
		ev(1, { kind: "message", role: "assistant", text: "First reply." }),
		ev(2, { kind: "status", status: "turn_completed" }),
		ev(3, { kind: "message", role: "assistant", text: "Second reply." }),
	]);
	expect(turns.map((t) => t.kind)).toEqual(["assistant", "assistant"]);
	expect(asAssistant(turns[0]).blocks).toEqual([
		{ kind: "text", text: "First reply." },
	]);
	expect(asAssistant(turns[1]).blocks).toEqual([
		{ kind: "text", text: "Second reply." },
	]);
});

it("still splits on a user message even mid text→tool→text", () => {
	const turns = foldEventsToTurns([
		ev(1, { kind: "message", role: "assistant", text: "Working on it." }),
		ev(2, {
			kind: "tool",
			id: "t1",
			name: "shell",
			input: { cmd: "ls" },
			status: "started",
		}),
		ev(3, { kind: "message", role: "user", text: "wait, stop" }),
		ev(4, { kind: "message", role: "assistant", text: "Stopped." }),
	]);
	expect(turns.map((t) => t.kind)).toEqual(["assistant", "user", "assistant"]);
	expect(asAssistant(turns[0]).blocks.map((b) => b.kind)).toEqual([
		"text",
		"tool",
	]);
	expect(asAssistant(turns[2]).blocks).toEqual([
		{ kind: "text", text: "Stopped." },
	]);
});

it("still splits a subagent Task call into its own task turn, not merged into the surrounding text", () => {
	const turns = foldEventsToTurns([
		ev(1, { kind: "message", role: "assistant", text: "Delegating." }),
		ev(2, {
			kind: "tool",
			id: "call_1",
			input: { description: "Run tests", prompt: "Run the test suite" },
			name: "Task",
			status: "started",
		}),
		ev(3, {
			kind: "tool",
			id: "call_1",
			name: "Task",
			output: "all tests passed",
			status: "completed",
		}),
		ev(4, { kind: "message", role: "assistant", text: "Done." }),
	]);
	expect(turns.map((t) => t.kind)).toEqual(["assistant", "task", "assistant"]);
	expect(asAssistant(turns[0]).blocks).toEqual([
		{ kind: "text", text: "Delegating." },
	]);
	expect(asAssistant(turns[2]).blocks).toEqual([
		{ kind: "text", text: "Done." },
	]);
});
