import { beforeEach, expect, it, vi } from "vitest";
import { AGENT_KIND, ALICE, build } from "../routers/bridge-test-helpers";
import { resetPushNotifyThrottleForTests } from "./push-notify";

// P3-T3: the ingest-side push hook (push-notify.ts), exercised end-to-end
// through the oRPC `pushEvents` route (which funnels into ingestEvents, the
// same core the WS events frame uses).

beforeEach(() => {
	resetPushNotifyThrottleForTests();
});

async function buildWithSession() {
	const fixture = build();
	const alice = fixture.userClientFor(ALICE);
	await alice.bridge.createToken({ agentKind: AGENT_KIND });
	const tokenId = (await fixture.bridgeToken.listByUser(ALICE.id))[0]
		?.id as string;
	const cli = fixture.bridgeClientFor({ tokenId, userId: ALICE.id });
	const { sessionId } = await cli.bridge.startSession({
		agentKind: AGENT_KIND,
		label: "my-agent",
	});
	return { fixture, cli, tokenId, sessionId };
}

/** Lets the fire-and-forget notify path (one store read + sends) settle. */
function flush() {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

it("an approval event pushes 需要审批 with the session deep link", async () => {
	const { fixture, cli, tokenId, sessionId } = await buildWithSession();
	await cli.bridge.pushEvents({
		sessionId,
		events: [
			{ kind: "approval", requestId: "r1", title: "Run ls?", options: [] },
		],
	});
	await vi.waitFor(() => expect(fixture.pushSends).toHaveLength(1));
	expect(fixture.pushSends[0]?.userId).toBe(ALICE.id);
	expect(fixture.pushSends[0]?.payload).toEqual({
		title: "需要审批",
		body: "my-agent：有待处理的审批/提问",
		url: `/local/${tokenId}?session=${sessionId}`,
		tag: `${sessionId}-approval`,
	});
});

it("turn_usage and error events push their own moments; other events do not", async () => {
	const { fixture, cli, sessionId } = await buildWithSession();
	await cli.bridge.pushEvents({
		sessionId,
		events: [
			{ kind: "message", role: "assistant", text: "hi" },
			{ kind: "status", status: "session_ready" },
			{ kind: "status", status: "turn_usage" },
			{ kind: "error", message: "boom" },
			// A cancelled approval is a retraction, not a new request.
			{ kind: "approval", requestId: "r2", cancelled: true, options: [] },
			// fix-approval-replay: a resolution event records an answer already
			// given — it must never buzz the phone as a new approval.
			{
				kind: "approval",
				answeredOptionId: "allow",
				options: [],
				requestId: "r3",
				title: "Answered",
			},
		],
	});
	await vi.waitFor(() => expect(fixture.pushSends).toHaveLength(2));
	const titles = fixture.pushSends.map((send) => send.payload.title).sort();
	expect(titles).toEqual(["出错了", "回合完成"]);
});

it("throttles to one push per session per moment-type per window", async () => {
	const { fixture, cli, sessionId } = await buildWithSession();
	const approval = {
		kind: "approval",
		requestId: "r1",
		title: "t",
		options: [],
	};
	await cli.bridge.pushEvents({ sessionId, events: [approval] });
	await cli.bridge.pushEvents({
		sessionId,
		events: [{ ...approval, requestId: "r2" }],
	});
	await flush();
	expect(fixture.pushSends).toHaveLength(1);
	// A different moment-type is throttled independently.
	await cli.bridge.pushEvents({
		sessionId,
		events: [{ kind: "error", message: "x" }],
	});
	await vi.waitFor(() => expect(fixture.pushSends).toHaveLength(2));
});

it("a failing push sender never fails ingest", async () => {
	const { fixture, cli, sessionId } = await buildWithSession();
	fixture.services.push = {
		vapidPublicKey: "k",
		sender: {
			sendToUser: () => Promise.reject(new Error("provider down")),
		},
	};
	const result = await cli.bridge.pushEvents({
		sessionId,
		events: [{ kind: "error", message: "boom" }],
	});
	expect(result).toEqual({ ok: true });
	await flush();
	// The event still landed in the relay/persisted history.
	const history = await fixture
		.userClientFor(ALICE)
		.bridge.history({ sessionId });
	expect(history).toHaveLength(1);
});

it("no-ops entirely when push is not configured", async () => {
	const { fixture, cli, sessionId } = await buildWithSession();
	fixture.services.push = null;
	const result = await cli.bridge.pushEvents({
		sessionId,
		events: [{ kind: "error", message: "boom" }],
	});
	expect(result).toEqual({ ok: true });
	await flush();
	expect(fixture.pushSends).toHaveLength(0);
});
