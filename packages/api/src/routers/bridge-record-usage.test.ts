import { expect, it } from "vitest";
import { AGENT_KIND, ALICE, build } from "./bridge-test-helpers";

// Task 4 (U0 · T0.5): bridge dual-write of claude `turn_usage` events into
// `usage_records` (docs/usage-stats-impl-plan.md §T0.5, decision D-4). Split
// out of bridge.test.ts purely to keep that file under the repo's
// max-lines-per-file gate.

const COST_USD = 0.0123;
const DURATION_MS = 4500;
const INPUT_TOKENS = 100;
const OUTPUT_TOKENS = 50;
const CACHE_READ_TOKENS = 10;
const CACHE_CREATION_TOKENS = 20;

const TURN_USAGE_EVENT = {
	kind: "status",
	status: "turn_usage",
	detail: {
		costUsd: COST_USD,
		numTurns: 1,
		durationMs: DURATION_MS,
		usage: {
			input_tokens: INPUT_TOKENS,
			output_tokens: OUTPUT_TOKENS,
			cache_read_input_tokens: CACHE_READ_TOKENS,
			cache_creation_input_tokens: CACHE_CREATION_TOKENS,
		},
		isError: false,
	},
};

it("pushEvents dual-writes a claude turn_usage event to usage_records", async () => {
	const { bridgeClientFor, usageRecord } = build();
	const cli = bridgeClientFor({ tokenId: "tok-1", userId: ALICE.id });
	const { sessionId } = await cli.bridge.startSession({
		agentKind: AGENT_KIND,
	});

	await cli.bridge.pushEvents({ sessionId, events: [TURN_USAGE_EVENT] });

	expect(usageRecord.inserted).toHaveLength(1);
	const [snapshot] = usageRecord.inserted;
	expect(snapshot?.source).toBe("bridge");
	expect(snapshot?.userId).toBe(ALICE.id);
	expect(snapshot?.sessionId).toBe(sessionId);
	expect(snapshot?.agentKind).toBe(AGENT_KIND);
	expect(snapshot?.dedupKey).toMatch(new RegExp(`^bridge:${sessionId}:\\d+$`));
	expect(snapshot?.tokens).toEqual({
		input: INPUT_TOKENS,
		output: OUTPUT_TOKENS,
		cacheRead: CACHE_READ_TOKENS,
		cacheWrite: CACHE_CREATION_TOKENS,
		reasoning: 0,
	});
	expect(snapshot?.costUsd).toBe(COST_USD);
	expect(snapshot?.priced).toBe(true);
	expect(snapshot?.durationMs).toBe(DURATION_MS);
});

it("pushEvents does NOT write usage_records for non-turn_usage events", async () => {
	const { bridgeClientFor, usageRecord } = build();
	const cli = bridgeClientFor({ tokenId: "tok-1", userId: ALICE.id });
	const { sessionId } = await cli.bridge.startSession({
		agentKind: AGENT_KIND,
	});

	await cli.bridge.pushEvents({
		sessionId,
		events: [
			{ type: "message", text: "hi" },
			{
				kind: "status",
				status: "usage_update",
				detail: { tokens: { input: 1 } },
			},
		],
	});

	expect(usageRecord.inserted).toHaveLength(0);
});

it("pushEvents still succeeds when the usage_records insert fails", async () => {
	const { userClientFor, bridgeClientFor, services } = build();
	const cli = bridgeClientFor({ tokenId: "tok-1", userId: ALICE.id });
	const { sessionId } = await cli.bridge.startSession({
		agentKind: AGENT_KIND,
	});

	services.stores.usageRecord.insert = () =>
		Promise.reject(new Error("db unavailable"));

	await expect(
		cli.bridge.pushEvents({ sessionId, events: [TURN_USAGE_EVENT] })
	).resolves.toEqual({ ok: true });

	// The rest of the event's persistence still happens despite the usage
	// insert failure (relay + bridgeMessage persistence are unaffected).
	const alice = userClientFor(ALICE);
	const events = await alice.bridge.observe({ sessionId, afterId: 0 });
	expect(events).toHaveLength(1);
});
