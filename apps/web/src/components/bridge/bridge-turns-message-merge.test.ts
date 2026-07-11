// Streaming/terminal id contract: codex's normalize emits BOTH a streamed
// `output` delta AND a final `message` for the same logical item, sharing
// the item's id (see normalize/codex.ts). These prove the web merges them
// into ONE bubble instead of rendering it twice — the reported "codex
// repeats every output" bug. Split into its own file (not bridge-turns.test.ts)
// to stay under the repo's 300-line-per-file cap.

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

it("merges a codex-style streamed delta and its final message (same id) into ONE bubble with the final text — no double render", () => {
	const turns = foldEventsToTurns([
		ev(1, { kind: "output", text: "Sure, ", id: "item_1" }),
		ev(2, { kind: "output", text: "let me check.", id: "item_1" }),
		ev(3, {
			kind: "message",
			role: "assistant",
			text: "Sure, let me check that for you.",
			id: "item_1",
		}),
	]);
	expect(turns).toHaveLength(1);
	const assistant = asAssistant(turns[0]);
	expect(assistant.blocks).toEqual([
		{ kind: "text", text: "Sure, let me check that for you." },
	]);
	// R1-T1: a message final is no longer a turn boundary by itself — the turn
	// stays open (state.current) so a following tool call can still join it
	// (see bridge-assistant-merge.ts). With nothing after it here, it's still
	// the trailing open turn.
	expect(assistant.streaming).toBe(true);
});

it("merges chunked deltas and a final sharing an id into one bubble (generic — not codex-specific)", () => {
	const turns = foldEventsToTurns([
		ev(1, { kind: "output", text: "Look", id: "msg_1" }),
		ev(2, { kind: "output", text: "ing", id: "msg_1" }),
		ev(3, {
			kind: "message",
			role: "assistant",
			text: "Looking into it.",
			id: "msg_1",
		}),
	]);
	expect(turns).toHaveLength(1);
	expect(asAssistant(turns[0]).blocks).toEqual([
		{ kind: "text", text: "Looking into it." },
	]);
});

it("preserves an interleaved tool block when the id-matched final replaces its text (targeted merge, not a full-turn wipe)", () => {
	const turns = foldEventsToTurns([
		ev(1, { kind: "output", text: "Checking the file", id: "item_1" }),
		ev(2, {
			kind: "tool",
			id: "t1",
			name: "shell",
			input: { cmd: "cat a.ts" },
			status: "started",
		}),
		ev(3, {
			kind: "tool",
			id: "t1",
			name: "shell",
			status: "completed",
			output: "ok",
		}),
		ev(4, {
			kind: "message",
			role: "assistant",
			text: "Checking the file — done.",
			id: "item_1",
		}),
	]);
	expect(turns).toHaveLength(1);
	const assistant = asAssistant(turns[0]);
	expect(assistant.blocks.map((b) => b.kind)).toEqual(["text", "tool"]);
	expect(assistant.blocks[0]).toEqual({
		kind: "text",
		text: "Checking the file — done.",
	});
});

it("R1-T1: a late/duplicate id-matched delta AFTER the final is dropped, not appended onto the sealed block", () => {
	const turns = foldEventsToTurns([
		ev(1, { kind: "output", text: "Sure, ", id: "item_1" }),
		ev(2, { kind: "output", text: "let me check.", id: "item_1" }),
		ev(3, {
			kind: "message",
			role: "assistant",
			text: "Sure, let me check that for you.",
			id: "item_1",
		}),
		// A straggler delta for the SAME id, arriving after the final already
		// sealed the block — e.g. a retried/duplicated network chunk. Per
		// last-write-wins, the final is canonical: this must be dropped, not
		// glued onto the already-committed text.
		ev(4, { kind: "output", text: "DUPLICATE-LATE", id: "item_1" }),
	]);
	expect(turns).toHaveLength(1);
	const assistant = asAssistant(turns[0]);
	expect(assistant.blocks).toEqual([
		{ kind: "text", text: "Sure, let me check that for you." },
	]);
});

it("claude-code/pi: an id-less final message still opens its own fresh bubble (no regression)", () => {
	const turns = foldEventsToTurns([
		ev(1, { kind: "output", text: "streamed reply" }),
		ev(2, { kind: "status", status: "turn-end" }),
		ev(3, {
			kind: "message",
			role: "assistant",
			text: "a separate final message",
		}),
	]);
	expect(turns.map((t) => t.kind)).toEqual([
		"assistant",
		"status",
		"assistant",
	]);
	expect(asAssistant(turns[0]).blocks).toEqual([
		{ kind: "text", text: "streamed reply" },
	]);
	expect(asAssistant(turns[2]).blocks).toEqual([
		{ kind: "text", text: "a separate final message" },
	]);
});
