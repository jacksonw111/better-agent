import type { ProjectQueryOutcome } from "@better-agent/agent/project-ports";
import { describe, expect, it } from "vitest";
import { createProjectQueryHub } from "./project-query-hub";

// Q2: the in-memory park behind projects.query — park→resolve round-trips
// the Computer's outcome, wrong-computer/late answers are refused without an
// oracle, and an unanswered query rejects after the timeout.

const OUTCOME: ProjectQueryOutcome = {
	ok: true,
	result: { entries: [{ kind: "file", name: "a.ts" }] },
};

describe("project query hub", () => {
	it("round-trips a parked query to the resolving computer", async () => {
		const hub = createProjectQueryHub();
		const parked = hub.park({ computerId: "comp-1", requestId: "req-1" });
		expect(hub.resolve("req-1", "comp-1", OUTCOME)).toBe(true);
		await expect(parked).resolves.toEqual(OUTCOME);
	});

	it("refuses an unknown requestId and a foreign computer identically", () => {
		const hub = createProjectQueryHub();
		hub.park({ computerId: "comp-1", requestId: "req-1" }).catch(() => {
			// Left to time out — this spec only exercises resolve().
		});
		expect(hub.resolve("req-1", "comp-2", OUTCOME)).toBe(false);
		expect(hub.resolve("nope", "comp-1", OUTCOME)).toBe(false);
		hub.cancel("req-1");
	});

	it("a duplicate resolve after the first is false", async () => {
		const hub = createProjectQueryHub();
		const parked = hub.park({ computerId: "comp-1", requestId: "req-1" });
		expect(hub.resolve("req-1", "comp-1", OUTCOME)).toBe(true);
		expect(hub.resolve("req-1", "comp-1", OUTCOME)).toBe(false);
		await parked;
	});

	it("rejects after the timeout and refuses the late answer", async () => {
		const hub = createProjectQueryHub({ timeoutMs: 5 });
		const parked = hub.park({ computerId: "comp-1", requestId: "req-1" });
		await expect(parked).rejects.toThrow("timed out");
		expect(hub.resolve("req-1", "comp-1", OUTCOME)).toBe(false);
	});

	it("cancel drops the parked entry so a later answer is refused", () => {
		const hub = createProjectQueryHub();
		hub.park({ computerId: "comp-1", requestId: "req-1" }).catch(() => {
			// Cancelled below before any settle — the promise is abandoned.
		});
		hub.cancel("req-1");
		expect(hub.resolve("req-1", "comp-1", OUTCOME)).toBe(false);
	});
});
