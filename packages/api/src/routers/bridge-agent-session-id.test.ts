import { expect, it } from "vitest";
import { AGENT_KIND, ALICE, BOB, build } from "./bridge-test-helpers";

// Phase 3 (Claude Code Online): pushEvents best-effort persists the
// underlying claude session id off a curated `session_ready` status event
// onto the bridge session row — see `maybePersistAgentSessionId` in
// bridge.ts. Split out of bridge.test.ts to keep that file under the repo's
// max-lines-per-file gate.

const SESSION_READY_EVENT = {
	kind: "status",
	status: "session_ready",
	detail: { sessionId: "claude-session-xyz", model: "claude-opus-4-6" },
};

it("pushEvents persists claude's session id from a session_ready event", async () => {
	const { bridgeClientFor, bridgeSession } = build();
	const cli = bridgeClientFor({ tokenId: "tok-1", userId: ALICE.id });
	const { sessionId } = await cli.bridge.startSession({
		agentKind: AGENT_KIND,
	});
	expect((await bridgeSession.get(sessionId))?.agentSessionId).toBeNull();

	await cli.bridge.pushEvents({ sessionId, events: [SESSION_READY_EVENT] });

	const row = await bridgeSession.get(sessionId);
	expect(row?.agentSessionId).toBe("claude-session-xyz");
});

it("pushEvents ignores an ordinary event's shape when persisting agentSessionId", async () => {
	const { bridgeClientFor, bridgeSession } = build();
	const cli = bridgeClientFor({ tokenId: "tok-1", userId: ALICE.id });
	const { sessionId } = await cli.bridge.startSession({
		agentKind: AGENT_KIND,
	});

	await cli.bridge.pushEvents({
		sessionId,
		events: [{ kind: "message", role: "assistant", text: "hi" }],
	});

	expect((await bridgeSession.get(sessionId))?.agentSessionId).toBeNull();
});

it("agentSessionId is owner-scoped like the rest of the session row", async () => {
	const { userClientFor, bridgeClientFor } = build();
	const cli = bridgeClientFor({ tokenId: "tok-1", userId: ALICE.id });
	const { sessionId } = await cli.bridge.startSession({
		agentKind: AGENT_KIND,
	});
	await cli.bridge.pushEvents({ sessionId, events: [SESSION_READY_EVENT] });

	const bob = userClientFor(BOB);
	expect((await bob.bridge.listSessions()).sessions).toHaveLength(0);

	const alice = userClientFor(ALICE);
	const [session] = (await alice.bridge.listSessions()).sessions;
	expect(session?.agentSessionId).toBe("claude-session-xyz");
});

it("pushEvents still succeeds live when setAgentSessionId fails", async () => {
	const { bridgeClientFor, services } = build();
	const cli = bridgeClientFor({ tokenId: "tok-1", userId: ALICE.id });
	const { sessionId } = await cli.bridge.startSession({
		agentKind: AGENT_KIND,
	});

	services.stores.bridgeSession.setAgentSessionId = () =>
		Promise.reject(new Error("db unavailable"));

	await expect(
		cli.bridge.pushEvents({ sessionId, events: [SESSION_READY_EVENT] })
	).resolves.toEqual({ ok: true });
});
