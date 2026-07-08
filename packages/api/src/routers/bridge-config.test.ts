import { expect, it } from "vitest";
import { AGENT_KIND, ALICE, BOB, build } from "./bridge-test-helpers";

// Phase 4: the persisted startup config (`appendSystemPrompt`, `maxTurns`) on
// a bridge token — owner-scoped read/write, and surfaced to the CLI via
// startSession so the adapter can apply it at launch. Split out of bridge.test.ts
// to keep that file under the 300-line limit.

it("updateTokenConfig persists config the owner can read back, and rejects a non-owner", async () => {
	const { userClientFor } = build();
	const alice = userClientFor(ALICE);
	const bob = userClientFor(BOB);
	const created = await alice.bridge.createToken({ agentKind: AGENT_KIND });

	const result = await alice.bridge.updateTokenConfig({
		config: {
			appendSystemPrompt: "Be terse.",
			maxTurns: 3,
			model: "claude-opus-4",
			permissionMode: "plan",
		},
		id: created.id,
	});
	expect(result).toEqual({ ok: true });

	const own = await alice.bridge.getToken({ id: created.id });
	expect(own?.config).toEqual({
		appendSystemPrompt: "Be terse.",
		maxTurns: 3,
		model: "claude-opus-4",
		permissionMode: "plan",
	});

	// A non-owner's update is a no-op (ok: false) and leaves the row untouched.
	const denied = await bob.bridge.updateTokenConfig({
		config: { maxTurns: 99, model: "gpt-5" },
		id: created.id,
	});
	expect(denied).toEqual({ ok: false });
	expect((await alice.bridge.getToken({ id: created.id }))?.config).toEqual({
		appendSystemPrompt: "Be terse.",
		maxTurns: 3,
		model: "claude-opus-4",
		permissionMode: "plan",
	});
});

it("startSession returns the token's persisted startup config", async () => {
	const { userClientFor, bridgeClientFor } = build();
	const alice = userClientFor(ALICE);
	const created = await alice.bridge.createToken({ agentKind: AGENT_KIND });
	await alice.bridge.updateTokenConfig({
		config: { appendSystemPrompt: "Be terse." },
		id: created.id,
	});

	const cli = bridgeClientFor({ tokenId: created.id, userId: ALICE.id });
	const started = await cli.bridge.startSession({ agentKind: AGENT_KIND });
	expect(started.config).toEqual({ appendSystemPrompt: "Be terse." });
});
