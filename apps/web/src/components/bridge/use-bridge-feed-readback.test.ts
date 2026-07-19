import { describe, expect, it } from "vitest";
import { feedReducer, initialFeedState } from "./use-bridge-feed";

// fix-caps-regression: the read-back folding must never fabricate a partial
// sessionReady (one that lost `capabilities`/`models`) — see
// session-ready-fold.ts for the id-tracked fold these assertions pin. Split
// out of use-bridge-feed.test.ts for the repo's max-lines-per-file gate.

const CAPS = { git: true, permissionModes: ["default"], sessionOps: [] };
const readyRaw = (id: number) => ({
	id,
	data: {
		kind: "status",
		status: "session_ready",
		detail: {
			capabilities: CAPS,
			model: "sonnet",
			models: ["sonnet", "opus"],
			permissionMode: "default",
		},
	},
});
const modeChangedRaw = (id: number, permissionMode: string) => ({
	id,
	data: {
		kind: "status",
		status: "permission_mode_changed",
		detail: { permissionMode },
	},
});

describe("feedReducer sessionReady read-back folding", () => {
	it("keeps capabilities and models when a read-back follows session_ready", () => {
		const seeded = feedReducer(initialFeedState, {
			type: "events",
			events: [readyRaw(1), modeChangedRaw(2, "plan")],
		});
		expect(seeded.sessionReady?.permissionMode).toBe("plan");
		expect(seeded.sessionReady?.capabilities).toEqual(CAPS);
		expect(seeded.sessionReady?.models).toEqual(["sonnet", "opus"]);
	});

	it("never fabricates a partial sessionReady from a read-back-first arrival", () => {
		const readbackFirst = feedReducer(initialFeedState, {
			type: "events",
			events: [modeChangedRaw(2, "plan")],
		});
		expect(readbackFirst.sessionReady).toBeNull();

		// The handshake backfills later (lower id, separate batch — the resume/
		// history-seed 乱序 case): the detail must come out COMPLETE, with the
		// newer read-back's mode on top.
		const recovered = feedReducer(readbackFirst, {
			type: "events",
			events: [readyRaw(1)],
		});
		expect(recovered.sessionReady?.capabilities).toEqual(CAPS);
		expect(recovered.sessionReady?.permissionMode).toBe("plan");
	});
});
