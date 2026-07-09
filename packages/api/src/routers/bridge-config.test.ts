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

// R3 restart orchestration: restartSession (web) appends a control:restart
// command without ending the session, and fetchConfig (bridge token) lets
// the restarting CLI re-fetch the token's current config without minting a
// new session (which would break the seamless-reconnect: a fresh startSession
// call mints a new sessionId).

it("restartSession appends a control:restart command and does not end the session", async () => {
	const { userClientFor, bridgeClientFor, bridgeSession } = build();
	const cli = bridgeClientFor({ tokenId: "tok-1", userId: ALICE.id });
	const { sessionId } = await cli.bridge.startSession({
		agentKind: AGENT_KIND,
	});

	const alice = userClientFor(ALICE);
	await expect(alice.bridge.restartSession({ sessionId })).resolves.toEqual({
		ok: true,
	});

	const commands = await cli.bridge.pollCommands({ sessionId, afterId: 0 });
	expect(commands).toHaveLength(1);
	expect(commands[0]?.data).toEqual({ type: "control", action: "restart" });

	const row = await bridgeSession.get(sessionId);
	expect(row?.status).toBe("active");
});

it("restartSession rejects a non-owner with NOT_FOUND", async () => {
	const { userClientFor, bridgeClientFor } = build();
	const cli = bridgeClientFor({ tokenId: "tok-1", userId: ALICE.id });
	const { sessionId } = await cli.bridge.startSession({
		agentKind: AGENT_KIND,
	});

	const bob = userClientFor(BOB);
	await expect(bob.bridge.restartSession({ sessionId })).rejects.toMatchObject({
		code: "NOT_FOUND",
	});
});

it("fetchConfig returns the calling token's current config after an update", async () => {
	const { userClientFor, bridgeClientFor } = build();
	const alice = userClientFor(ALICE);
	const created = await alice.bridge.createToken({ agentKind: AGENT_KIND });
	await alice.bridge.updateTokenConfig({
		config: { appendSystemPrompt: "Be terse.", maxTurns: 5 },
		id: created.id,
	});

	const cli = bridgeClientFor({ tokenId: created.id, userId: ALICE.id });
	const result = await cli.bridge.fetchConfig();
	expect(result).toEqual({
		config: { appendSystemPrompt: "Be terse.", maxTurns: 5 },
	});
});

it("fetchConfig scopes to the caller's own token, not another token's config", async () => {
	const { userClientFor, bridgeClientFor } = build();
	const alice = userClientFor(ALICE);
	const tokenA = await alice.bridge.createToken({ agentKind: AGENT_KIND });
	const tokenB = await alice.bridge.createToken({ agentKind: AGENT_KIND });
	await alice.bridge.updateTokenConfig({
		config: { model: "claude-opus-4" },
		id: tokenA.id,
	});
	await alice.bridge.updateTokenConfig({
		config: { model: "gpt-5" },
		id: tokenB.id,
	});

	const cliA = bridgeClientFor({ tokenId: tokenA.id, userId: ALICE.id });
	const cliB = bridgeClientFor({ tokenId: tokenB.id, userId: ALICE.id });
	expect(await cliA.bridge.fetchConfig()).toEqual({
		config: { model: "claude-opus-4" },
	});
	expect(await cliB.bridge.fetchConfig()).toEqual({
		config: { model: "gpt-5" },
	});
});
