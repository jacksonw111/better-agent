import { expect, it } from "vitest";
import type { StreamEvent } from "./bridge-events";
import { foldEventsToTurns } from "./bridge-turns";

// RC-T3 (docs/remote-control-redesign-plan.md, Pillar 3): a cancelled
// approval event retracts a still-open approval card instead of rendering as
// a new turn — split out of bridge-turns.test.ts purely to keep that file
// under the repo's 300-line limit.

const ev = (id: number, event: StreamEvent["event"]): StreamEvent => ({
	id,
	event,
});

it("removes a still-open approval card when a matching cancelled event arrives", () => {
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
	expect(turns).toHaveLength(0);
});

it("leaves other open approval cards alone when a differently-id'd cancel arrives", () => {
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
	expect(turns[0].kind).toBe("approval");
});
