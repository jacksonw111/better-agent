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

// fix-send-outbox: the SAME idempotency contract on the OTHER direction —
// the web's send outbox (apps/web/src/components/bridge/send-outbox.ts)
// retries a send whose response was lost, carrying the same client-minted
// key, and must not deliver the command to the agent twice.

it("sendInput is idempotent: resending with the same idempotencyKey queues one command", async () => {
	const { userClientFor, bridgeClientFor } = build();
	const cli = bridgeClientFor({ tokenId: "tok-1", userId: ALICE.id });
	const { sessionId } = await cli.bridge.startSession({
		agentKind: AGENT_KIND,
	});
	const alice = userClientFor(ALICE);

	await alice.bridge.sendInput({
		sessionId,
		data: "hello",
		idempotencyKey: "send-1",
	});
	// The ack for the call above is "lost" from the browser's perspective — the
	// outbox retries the identical send, same key.
	await alice.bridge.sendInput({
		sessionId,
		data: "hello",
		idempotencyKey: "send-1",
	});

	const commands = await cli.bridge.pollCommands({ sessionId, afterId: 0 });
	expect(commands).toHaveLength(1);
	expect(commands[0]?.data).toBe("hello");
});

it("sendInput dedupes per key: a different idempotencyKey still queues its own command", async () => {
	const { userClientFor, bridgeClientFor } = build();
	const cli = bridgeClientFor({ tokenId: "tok-1", userId: ALICE.id });
	const { sessionId } = await cli.bridge.startSession({
		agentKind: AGENT_KIND,
	});
	const alice = userClientFor(ALICE);

	await alice.bridge.sendInput({ sessionId, data: "a", idempotencyKey: "k1" });
	await alice.bridge.sendInput({ sessionId, data: "b", idempotencyKey: "k2" });

	const commands = await cli.bridge.pollCommands({ sessionId, afterId: 0 });
	expect(commands.map((command) => command.data)).toEqual(["a", "b"]);
});

it("sendInput without an idempotencyKey keeps the pre-outbox behavior: a resend is NOT deduped", async () => {
	const { userClientFor, bridgeClientFor } = build();
	const cli = bridgeClientFor({ tokenId: "tok-1", userId: ALICE.id });
	const { sessionId } = await cli.bridge.startSession({
		agentKind: AGENT_KIND,
	});
	const alice = userClientFor(ALICE);

	await alice.bridge.sendInput({ sessionId, data: "hi" });
	await alice.bridge.sendInput({ sessionId, data: "hi" });

	const commands = await cli.bridge.pollCommands({ sessionId, afterId: 0 });
	expect(commands).toHaveLength(2);
});
