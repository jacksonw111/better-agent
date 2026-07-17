import { expect, it, vi } from "vitest";
import { AGENT_KIND, ALICE, BOB, build } from "./bridge-test-helpers";

// P5-1: `bridge.pendingRequests` — still-unanswered approval/question replay
// for a (re)connecting web client, plus the answered-from-any-device set.
// Events reach the persisted stream through the same `pushEvents` ingest the
// CLI uses; answers travel as relay commands via `sendInput`, exactly as the
// web sends them (see use-bridge-terminal-actions.ts).

const FIVE_MINUTES_MS = 300_000;
const SIX_MINUTES_MS = 360_000;

async function setup() {
	const built = build();
	const alice = built.userClientFor(ALICE);
	await alice.bridge.createToken({ agentKind: AGENT_KIND });
	const tokenId = (await built.bridgeToken.listByUser(ALICE.id))[0]
		?.id as string;
	const cli = built.bridgeClientFor({ tokenId, userId: ALICE.id });
	const { sessionId } = await cli.bridge.startSession({
		agentKind: AGENT_KIND,
	});
	return { ...built, alice, cli, sessionId };
}

function approvalEvent(requestId: string, extra: Record<string, unknown> = {}) {
	return {
		kind: "approval",
		requestId,
		title: "Run `rm -rf tmp/`?",
		options: [
			{ id: "allow", label: "Allow" },
			{ id: "deny", label: "Deny" },
		],
		timeoutAt: Date.now() + FIVE_MINUTES_MS,
		...extra,
	};
}

it("returns a still-unanswered approval verbatim, with its persisted seq", async () => {
	const { alice, cli, sessionId } = await setup();
	const approval = approvalEvent("req-1");
	await cli.bridge.pushEvents({
		sessionId,
		events: [{ kind: "message", role: "assistant", text: "hi" }, approval],
	});

	const result = await alice.bridge.pendingRequests({ sessionId });
	expect(result.answered).toEqual([]);
	expect(result.pending).toEqual([
		{ seq: 2, requestId: "req-1", event: approval },
	]);
});

it("a cancelled retraction closes the request", async () => {
	const { alice, cli, sessionId } = await setup();
	await cli.bridge.pushEvents({
		sessionId,
		events: [
			approvalEvent("req-1"),
			{ kind: "approval", requestId: "req-1", cancelled: true, options: [] },
		],
	});

	const result = await alice.bridge.pendingRequests({ sessionId });
	expect(result.pending).toEqual([]);
});

it("an approval answered from any device leaves pending and lands in answered", async () => {
	const { alice, cli, sessionId } = await setup();
	await cli.bridge.pushEvents({
		sessionId,
		events: [approvalEvent("req-1")],
	});
	await alice.bridge.sendInput({
		sessionId,
		data: { type: "approval", requestId: "req-1", optionId: "allow" },
	});

	const result = await alice.bridge.pendingRequests({ sessionId });
	expect(result.pending).toEqual([]);
	expect(result.answered).toEqual([
		{ kind: "approval", optionId: "allow", requestId: "req-1" },
	]);
});

it("a persisted resolution event closes the request even when the answer command is gone from the relay window", async () => {
	const { alice, cli, sessionId } = await setup();
	// No sendInput here on purpose: the commands tail is empty, mimicking an
	// answer whose relay command has expired (or lives in another isolate) —
	// only the CLI's persisted resolution event can close the request.
	await cli.bridge.pushEvents({
		sessionId,
		events: [
			approvalEvent("req-1"),
			{
				kind: "approval",
				answeredOptionId: "allow",
				options: [],
				requestId: "req-1",
				title: "Answered",
			},
		],
	});

	const result = await alice.bridge.pendingRequests({ sessionId });
	expect(result.pending).toEqual([]);
});

it("a question flows the same way: open until its answerQuestion command lands", async () => {
	const { alice, cli, sessionId } = await setup();
	const question = {
		kind: "question",
		requestId: "q-1",
		title: "Pick one",
		questions: [{ question: "which?", options: [{ label: "a" }] }],
		timeoutAt: Date.now() + FIVE_MINUTES_MS,
	};
	await cli.bridge.pushEvents({ sessionId, events: [question] });

	const open = await alice.bridge.pendingRequests({ sessionId });
	expect(open.pending).toEqual([{ seq: 1, requestId: "q-1", event: question }]);

	await alice.bridge.sendInput({
		sessionId,
		data: {
			type: "control",
			action: "answerQuestion",
			requestId: "q-1",
			answers: [["a"]],
		},
	});
	const closed = await alice.bridge.pendingRequests({ sessionId });
	expect(closed.pending).toEqual([]);
	expect(closed.answered).toEqual([
		{ answers: [["a"]], kind: "question", requestId: "q-1" },
	]);
});

it("a persisted question resolution event closes the request even when the answer command is gone from the relay window", async () => {
	const { alice, cli, sessionId } = await setup();
	// fix-question-replay: mirrors the approval resolution test above — no
	// sendInput on purpose, only the CLI's persisted resolution event (kind
	// "question" + answeredAnswers) can close the request.
	await cli.bridge.pushEvents({
		sessionId,
		events: [
			{
				kind: "question",
				requestId: "q-1",
				title: "Pick one",
				questions: [{ question: "which?", options: [{ label: "a" }] }],
				timeoutAt: Date.now() + FIVE_MINUTES_MS,
			},
			{
				kind: "question",
				answeredAnswers: [["a"]],
				questions: [],
				requestId: "q-1",
				title: "Answered",
			},
		],
	});

	const result = await alice.bridge.pendingRequests({ sessionId });
	expect(result.pending).toEqual([]);
});

it("a request whose fail-closed timeout has passed is never replayed", async () => {
	const { alice, cli, sessionId } = await setup();
	await cli.bridge.pushEvents({
		sessionId,
		events: [approvalEvent("req-1", { timeoutAt: Date.now() - 1 })],
	});

	const result = await alice.bridge.pendingRequests({ sessionId });
	expect(result.pending).toEqual([]);
});

it("an ended session replays nothing open but still reports answers", async () => {
	const { alice, cli, sessionId } = await setup();
	await cli.bridge.pushEvents({ sessionId, events: [approvalEvent("req-1")] });
	await alice.bridge.sendInput({
		sessionId,
		data: { type: "approval", requestId: "req-1", optionId: "deny" },
	});
	await alice.bridge.endSession({ sessionId });

	const result = await alice.bridge.pendingRequests({ sessionId });
	expect(result.pending).toEqual([]);
	expect(result.answered).toEqual([
		{ kind: "approval", optionId: "deny", requestId: "req-1" },
	]);
});

it("a session not seen recently replays nothing — its CLI can't take answers", async () => {
	vi.useFakeTimers();
	try {
		vi.setSystemTime(new Date("2026-07-15T00:00:00Z"));
		const { alice, cli, sessionId } = await setup();
		// timeoutAt far beyond the recency window, so THIS test isolates the
		// liveness gate rather than the expiry filter.
		await cli.bridge.pushEvents({
			sessionId,
			events: [
				approvalEvent("req-1", { timeoutAt: Date.now() + SIX_MINUTES_MS * 10 }),
			],
		});
		vi.setSystemTime(Date.now() + SIX_MINUTES_MS);

		const result = await alice.bridge.pendingRequests({ sessionId });
		expect(result.pending).toEqual([]);
	} finally {
		vi.useRealTimers();
	}
});

it("rejects a non-owner with NOT_FOUND", async () => {
	const { cli, sessionId, userClientFor } = await setup();
	await cli.bridge.pushEvents({ sessionId, events: [approvalEvent("req-1")] });

	await expect(
		userClientFor(BOB).bridge.pendingRequests({ sessionId })
	).rejects.toMatchObject({ code: "NOT_FOUND" });
});
