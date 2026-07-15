import { expect, it } from "vitest";
import type { StreamEvent } from "./bridge-events";
import { foldEventsToTurns } from "./bridge-turns";

// RC-T3 (docs/remote-control-redesign-plan.md, Pillar 3): a cancelled
// approval event retracts a still-open approval block (now embedded in an
// assistant turn) instead of rendering as a new block.

const ev = (id: number, event: StreamEvent["event"]): StreamEvent => ({
	id,
	event,
});

it("removes a still-open approval block when a matching cancelled event arrives", () => {
	const turns = foldEventsToTurns([
		ev(1, {
			kind: "approval",
			options: [{ id: "allow", label: "Allow" }],
			requestId: "req_1",
			title: "Run `rm`",
		}),
		ev(2, {
			kind: "approval",
			cancelled: true,
			options: [],
			requestId: "req_1",
			title: "Cancelled",
		}),
	]);
	// The block was the turn's only content, so retracting it drops the turn.
	expect(turns).toHaveLength(0);
});

it("leaves other open approval blocks alone when a differently-id'd cancel arrives", () => {
	const turns = foldEventsToTurns([
		ev(1, {
			kind: "approval",
			options: [{ id: "allow", label: "Allow" }],
			requestId: "req_1",
			title: "Run `rm`",
		}),
		ev(2, {
			kind: "approval",
			cancelled: true,
			options: [],
			requestId: "req_2",
			title: "Cancelled",
		}),
	]);
	expect(turns).toHaveLength(1);
	expect(turns[0].kind).toBe("assistant");
	const turn = turns[0];
	expect(
		turn.kind === "assistant" &&
			turn.blocks.some(
				(block) =>
					block.kind === "approval" && block.approval.requestId === "req_1"
			)
	).toBe(true);
});

it("keeps an assistant turn's other content when retracting its approval block", () => {
	const turns = foldEventsToTurns([
		ev(1, { kind: "output", text: "I'll run it." }),
		ev(2, {
			kind: "approval",
			options: [{ id: "allow", label: "Allow" }],
			requestId: "req_1",
			title: "Run `rm`",
		}),
		ev(3, {
			kind: "approval",
			cancelled: true,
			options: [],
			requestId: "req_1",
			title: "Cancelled",
		}),
	]);
	// The text block remains; only the approval block is gone.
	expect(turns).toHaveLength(1);
	const turn = turns[0];
	expect(
		turn.kind === "assistant" &&
			turn.blocks.some((block) => block.kind === "text") &&
			!turn.blocks.some((block) => block.kind === "approval")
	).toBe(true);
});
