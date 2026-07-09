import { expect, it } from "vitest";
import { AGENT_KIND, ALICE, build } from "./bridge-test-helpers";

// T1 (docs/remote-control-redesign-plan.md): the CLI's push-queue resends a
// whole batch verbatim when a successful push's ack is lost — same
// sessionId, same events, same idempotencyKeys. These simulate exactly that
// resend at the router level. Split out of bridge.test.ts to keep that file
// under the repo's max-lines-per-file cap.

it("pushEvents is idempotent: resending the same batch with the same idempotencyKeys is a no-op", async () => {
	const { userClientFor, bridgeClientFor, bridgeMessage } = build();
	const cli = bridgeClientFor({ tokenId: "tok-1", userId: ALICE.id });
	const { sessionId } = await cli.bridge.startSession({
		agentKind: AGENT_KIND,
	});
	const events = [{ type: "message", text: "hi" }, { type: "output" }];
	const idempotencyKeys = ["1", "2"];

	await cli.bridge.pushEvents({ sessionId, events, idempotencyKeys });
	// The ack for the call above is "lost" from the CLI's perspective — it
	// resends the identical batch, same idempotencyKeys.
	await cli.bridge.pushEvents({ sessionId, events, idempotencyKeys });

	const alice = userClientFor(ALICE);
	const observed = await alice.bridge.observe({ sessionId, afterId: 0 });
	expect(observed).toHaveLength(events.length);
	expect(observed.map((event) => event.data)).toEqual(events);

	const history = await alice.bridge.history({ sessionId });
	expect(history).toHaveLength(events.length); // no duplicate bridge_messages rows either
	expect(await bridgeMessage.list(sessionId, 0, 100)).toHaveLength(
		events.length
	);
});

it("pushEvents without idempotencyKeys keeps the pre-T1 behavior: a resend is NOT deduped", async () => {
	const { userClientFor, bridgeClientFor } = build();
	const cli = bridgeClientFor({ tokenId: "tok-1", userId: ALICE.id });
	const { sessionId } = await cli.bridge.startSession({
		agentKind: AGENT_KIND,
	});
	const events = [{ ok: true }];

	await cli.bridge.pushEvents({ sessionId, events });
	await cli.bridge.pushEvents({ sessionId, events });

	const alice = userClientFor(ALICE);
	const observed = await alice.bridge.observe({ sessionId, afterId: 0 });
	expect(observed).toHaveLength(2);
});
