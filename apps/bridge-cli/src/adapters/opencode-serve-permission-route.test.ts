// R3-T3 item 4: unit-tests `postPermissionReply`'s new/legacy/unknown route
// selection directly against a fake `ServeSessionContext` — split out of
// opencode-serve.test.ts (which covers this end-to-end through `startServe()`)
// because the `"unknown"` race can't be reached that way: `startServe()`
// always awaits `start()`'s health probe to completion before handing a test
// its `handle` (see opencode-serve-agent.test.ts's `fakeHttp` for the same
// direct-unit-test pattern applied to `fetchServeAgents`/`fetchServeHealth`).

import { describe, expect, it, vi } from "vitest";
import type { NormalizedEvent } from "../normalize/types";
import type {
	PermissionRouteHint,
	ServeSessionContext,
} from "./opencode-serve";
import { postPermissionReply } from "./opencode-serve-approvals";
import { type ServeHttp, ServeHttpError } from "./opencode-serve-http";

function fakeCtx(
	postJson: ServeHttp["postJson"],
	hint: PermissionRouteHint
): { ctx: ServeSessionContext; events: NormalizedEvent[] } {
	const events: NormalizedEvent[] = [];
	const http: ServeHttp = {
		baseUrl: "http://fake",
		getJson: vi.fn(),
		headers: {},
		postJson,
	};
	const ctx = {
		approvals: {} as ServeSessionContext["approvals"],
		epoch: {} as ServeSessionContext["epoch"],
		events: {
			close: vi.fn(),
			push: (event: NormalizedEvent) => events.push(event),
		},
		http,
		permissionRouteHint: hint,
		questions: {} as ServeSessionContext["questions"],
		sessionId: "ses_1",
	} satisfies ServeSessionContext;
	return { ctx, events };
}

// Split into two `describe` blocks purely to keep each callback under the
// repo's max-lines-per-function gate (which counts `describe`'s arrow
// function body, not just top-level functions).
describe("postPermissionReply - known route hint (R3-T3 item 4)", () => {
	it('posts the NEW route when the hint is already "new"', async () => {
		const postJson = vi.fn().mockResolvedValue({});
		const { ctx } = fakeCtx(postJson, { current: "new" });

		postPermissionReply(ctx, "perm_1", "once");
		await vi.waitFor(() => expect(postJson).toHaveBeenCalled());

		expect(postJson).toHaveBeenCalledExactlyOnceWith(
			"/permission/perm_1/reply",
			{
				reply: "once",
			}
		);
	});

	it('posts the deprecated route directly when the hint is "legacy"', () => {
		const postJson = vi.fn().mockResolvedValue({});
		const { ctx } = fakeCtx(postJson, { current: "legacy" });

		postPermissionReply(ctx, "perm_1", "once");

		// firePost (used for the deprecated route) always forwards its optional
		// `timeoutMs` positionally, so the third arg is an explicit `undefined`.
		expect(postJson).toHaveBeenCalledExactlyOnceWith(
			"/session/ses_1/permissions/perm_1",
			{ response: "once" },
			undefined
		);
	});
});

describe("postPermissionReply - unknown route hint, resolves cleanly (R3-T3 item 4)", () => {
	it('tries the NEW route first when "unknown" and learns "new" on success', async () => {
		const postJson = vi.fn().mockResolvedValue({});
		const { ctx } = fakeCtx(postJson, { current: "unknown" });

		postPermissionReply(ctx, "perm_1", "once");
		await vi.waitFor(() => expect(postJson).toHaveBeenCalled());

		expect(postJson).toHaveBeenCalledExactlyOnceWith(
			"/permission/perm_1/reply",
			{
				reply: "once",
			}
		);
		expect(ctx.permissionRouteHint.current).toBe("new");
	});

	it('pushes an error event (no fallback) when the hint is already "new" and the route fails', async () => {
		const postJson = vi.fn().mockRejectedValue(new Error("boom"));
		const { ctx, events } = fakeCtx(postJson, { current: "new" });

		postPermissionReply(ctx, "perm_1", "once");
		await vi.waitFor(() => expect(events.length).toBeGreaterThan(0));

		expect(postJson).toHaveBeenCalledExactlyOnceWith(
			"/permission/perm_1/reply",
			{
				reply: "once",
			}
		);
		expect(events[0]).toMatchObject({ kind: "error" });
	});
});

const HTTP_NOT_FOUND = 404;
const SECOND_CALL_INDEX = 2;

describe("postPermissionReply - unknown route hint, 404 fallback (R3-T3 item 4)", () => {
	it('falls back to the deprecated route ONCE when "unknown" and the new route 404s, and learns "legacy"', async () => {
		const postJson = vi
			.fn()
			.mockRejectedValueOnce(
				new ServeHttpError(
					"opencode serve POST /permission/perm_1/reply → HTTP 404",
					HTTP_NOT_FOUND
				)
			)
			.mockResolvedValueOnce({});
		const { ctx } = fakeCtx(postJson, { current: "unknown" });

		postPermissionReply(ctx, "perm_1", "once");
		await vi.waitFor(() =>
			expect(postJson).toHaveBeenCalledTimes(SECOND_CALL_INDEX)
		);

		expect(postJson).toHaveBeenNthCalledWith(1, "/permission/perm_1/reply", {
			reply: "once",
		});
		expect(postJson).toHaveBeenNthCalledWith(
			SECOND_CALL_INDEX,
			"/session/ses_1/permissions/perm_1",
			{ response: "once" },
			undefined
		);
		expect(ctx.permissionRouteHint.current).toBe("legacy");
	});
});
