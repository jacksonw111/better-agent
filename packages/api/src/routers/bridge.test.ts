import { createRouterClient } from "@orpc/server";
import { expect, it } from "vitest";
import { createContext } from "../context";
import {
	AGENT_KIND,
	ALICE,
	BOB,
	build,
	fakeHonoRequest,
} from "./bridge-test-helpers";
import { appRouter } from "./index";

it("createToken binds a chosen agentKind and the raw token stays owner-viewable", async () => {
	const { userClientFor } = build();
	const alice = userClientFor(ALICE);
	const created = await alice.bridge.createToken({ agentKind: "codex" });
	expect(created.token.startsWith("bt_")).toBe(true);
	expect(created.id).toBeTruthy();

	const tokens = await alice.bridge.listTokens();
	expect(tokens).toHaveLength(1);
	expect(tokens[0]?.agentKind).toBe("codex");
	expect(tokens[0]?.token).toBe(created.token);
	expect(tokens[0]).not.toHaveProperty("tokenHash");
	expect(tokens[0]?.last4).toBe(created.last4);

	await expect(
		userClientFor(BOB).bridge.createToken({ agentKind: "x" } as never)
	).rejects.toBeDefined();
});

it("getToken returns the caller's own raw token and rejects a non-owner", async () => {
	const { userClientFor } = build();
	const alice = userClientFor(ALICE);
	const bob = userClientFor(BOB);
	const created = await alice.bridge.createToken({ agentKind: AGENT_KIND });
	const tokens = await alice.bridge.listTokens();
	const tokenId = tokens[0]?.id as string;

	const own = await alice.bridge.getToken({ id: tokenId });
	expect(own?.token).toBe(created.token);
	expect(own?.agentKind).toBe(AGENT_KIND);
	expect(await bob.bridge.getToken({ id: tokenId })).toBeNull();
});

it("deleteToken removes the token AND its sessions, owner-scoped", async () => {
	const { userClientFor, bridgeClientFor, bridgeToken } = build();
	const alice = userClientFor(ALICE);
	const bob = userClientFor(BOB);
	await alice.bridge.createToken({ agentKind: AGENT_KIND });
	const tokenId = (await bridgeToken.listByUser(ALICE.id))[0]?.id as string;

	const cli = bridgeClientFor({ tokenId, userId: ALICE.id });
	await cli.bridge.startSession({ agentKind: AGENT_KIND });
	expect(await alice.bridge.listSessions()).toHaveLength(1);

	await bob.bridge.deleteToken({ id: tokenId });
	expect(await bridgeToken.listByUser(ALICE.id)).toHaveLength(1);

	await alice.bridge.deleteToken({ id: tokenId });
	expect(await bridgeToken.listByUser(ALICE.id)).toHaveLength(0);
	expect(await alice.bridge.listSessions()).toHaveLength(0);
});

it("a deleted raw bridge token is rejected end-to-end by bridgeProcedure", async () => {
	const { userClientFor, bridgeToken, services } = build();
	const alice = userClientFor(ALICE);
	const created = await alice.bridge.createToken({ agentKind: AGENT_KIND });
	const tokenId = (await bridgeToken.listByUser(ALICE.id))[0]?.id as string;
	await alice.bridge.deleteToken({ id: tokenId });

	// Re-derive the context from the raw deleted token, as the HTTP layer would.
	const context = await createContext({
		context: fakeHonoRequest(`Bearer ${created.token}`),
		services: services as never,
	});
	expect(context.authedBridgeToken).toBeNull();

	const cli = createRouterClient(appRouter, { context });
	await expect(
		cli.bridge.startSession({ agentKind: AGENT_KIND })
	).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});

it("startSession binds a session to the bridge token's user", async () => {
	const { bridgeClientFor, bridgeSession } = build();
	const cli = bridgeClientFor({ tokenId: "tok-1", userId: ALICE.id });
	const { sessionId } = await cli.bridge.startSession({
		agentKind: AGENT_KIND,
	});
	const row = await bridgeSession.get(sessionId);
	expect(row?.userId).toBe(ALICE.id);
	expect(row?.tokenId).toBe("tok-1");
});

it("startSession accepts every documented agentKind, including pi", async () => {
	const { bridgeClientFor } = build();
	const cli = bridgeClientFor({ tokenId: "tok-1", userId: ALICE.id });
	const { sessionId } = await cli.bridge.startSession({ agentKind: "pi" });
	expect(sessionId).toBeTruthy();
});

it("a bridge-token session pushes events the owner can observe via poll", async () => {
	const { userClientFor, bridgeClientFor } = build();
	const cli = bridgeClientFor({ tokenId: "tok-1", userId: ALICE.id });
	const { sessionId } = await cli.bridge.startSession({
		agentKind: AGENT_KIND,
	});

	await cli.bridge.pushEvents({
		sessionId,
		events: [{ type: "stdout", chunk: "hello" }],
	});

	const alice = userClientFor(ALICE);
	const events = await alice.bridge.observe({ sessionId, afterId: 0 });
	expect(events).toHaveLength(1);
	expect(events[0]?.data).toEqual({ type: "stdout", chunk: "hello" });
});

it("observe rejects a non-owner with NOT_FOUND", async () => {
	const { userClientFor, bridgeClientFor } = build();
	const cli = bridgeClientFor({ tokenId: "tok-1", userId: ALICE.id });
	const { sessionId } = await cli.bridge.startSession({
		agentKind: AGENT_KIND,
	});
	await cli.bridge.pushEvents({ sessionId, events: [{ ok: true }] });

	const bob = userClientFor(BOB);
	await expect(
		bob.bridge.observe({ sessionId, afterId: 0 })
	).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("pushEvents rejects a non-owner bridge token with NOT_FOUND", async () => {
	const { bridgeClientFor } = build();
	const cli = bridgeClientFor({ tokenId: "tok-1", userId: ALICE.id });
	const { sessionId } = await cli.bridge.startSession({
		agentKind: AGENT_KIND,
	});

	const otherCli = bridgeClientFor({ tokenId: "tok-2", userId: BOB.id });
	await expect(
		otherCli.bridge.pushEvents({ sessionId, events: [{ ok: true }] })
	).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("sendInput lands in pollCommands", async () => {
	const { userClientFor, bridgeClientFor } = build();
	const cli = bridgeClientFor({ tokenId: "tok-1", userId: ALICE.id });
	const { sessionId } = await cli.bridge.startSession({
		agentKind: AGENT_KIND,
	});

	const alice = userClientFor(ALICE);
	await alice.bridge.sendInput({ sessionId, data: { keys: "y\n" } });

	const commands = await cli.bridge.pollCommands({ sessionId, afterId: 0 });
	expect(commands).toHaveLength(1);
	expect(commands[0]?.data).toEqual({ keys: "y\n" });
});

it("listSessions and endSession are scoped to the caller", async () => {
	const { userClientFor, bridgeClientFor } = build();
	const cli = bridgeClientFor({ tokenId: "tok-1", userId: ALICE.id });
	const { sessionId } = await cli.bridge.startSession({
		agentKind: AGENT_KIND,
	});

	const alice = userClientFor(ALICE);
	const bob = userClientFor(BOB);

	expect(await bob.bridge.listSessions()).toHaveLength(0);
	expect(await alice.bridge.listSessions()).toHaveLength(1);

	await expect(bob.bridge.endSession({ sessionId })).rejects.toMatchObject({
		code: "NOT_FOUND",
	});

	await alice.bridge.endSession({ sessionId });
	const [session] = await alice.bridge.listSessions();
	expect(session?.status).toBe("ended");
});

it("endSession still ends the session when the relay append fails", async () => {
	const { userClientFor, bridgeClientFor, services, bridgeSession } = build();
	const cli = bridgeClientFor({ tokenId: "tok-1", userId: ALICE.id });
	const { sessionId } = await cli.bridge.startSession({
		agentKind: AGENT_KIND,
	});

	// Simulate a transient Redis failure on the relay's append call. The DB
	// status flip must remain authoritative: endSession should still resolve
	// ok and the session should still read as ended.
	services.relayStore.append = () =>
		Promise.reject(new Error("relay unavailable"));

	const alice = userClientFor(ALICE);
	await expect(alice.bridge.endSession({ sessionId })).resolves.toEqual({
		ok: true,
	});

	const row = await bridgeSession.get(sessionId);
	expect(row?.status).toBe("ended");
});

it("endSession appends a control:stop command the CLI's poll would see", async () => {
	const { userClientFor, bridgeClientFor } = build();
	const cli = bridgeClientFor({ tokenId: "tok-1", userId: ALICE.id });
	const { sessionId } = await cli.bridge.startSession({
		agentKind: AGENT_KIND,
	});

	const alice = userClientFor(ALICE);
	await alice.bridge.endSession({ sessionId });

	const commands = await cli.bridge.pollCommands({ sessionId, afterId: 0 });
	expect(commands).toHaveLength(1);
	expect(commands[0]?.data).toEqual({ type: "control", action: "stop" });
});

it("pushEvents persists events; history returns them in order for the owner", async () => {
	const { userClientFor, bridgeClientFor } = build();
	const cli = bridgeClientFor({ tokenId: "tok-1", userId: ALICE.id });
	const { sessionId } = await cli.bridge.startSession({
		agentKind: AGENT_KIND,
	});

	await cli.bridge.pushEvents({
		sessionId,
		events: [
			{ type: "message", text: "hi" },
			{ type: "output", text: "ok" },
		],
	});

	const alice = userClientFor(ALICE);
	const history = await alice.bridge.history({ sessionId });
	expect(history).toHaveLength(2);
	expect(history[0]?.event).toEqual({ type: "message", text: "hi" });
	expect(history[1]?.event).toEqual({ type: "output", text: "ok" });
	expect(history[1]?.seq).toBeGreaterThan(history[0]?.seq ?? 0);
});

it("history is owner-scoped: a non-owner gets NOT_FOUND", async () => {
	const { userClientFor, bridgeClientFor } = build();
	const cli = bridgeClientFor({ tokenId: "tok-1", userId: ALICE.id });
	const { sessionId } = await cli.bridge.startSession({
		agentKind: AGENT_KIND,
	});
	await cli.bridge.pushEvents({ sessionId, events: [{ ok: true }] });

	const bob = userClientFor(BOB);
	await expect(bob.bridge.history({ sessionId })).rejects.toMatchObject({
		code: "NOT_FOUND",
	});
});

it("history paginates via afterSeq", async () => {
	const { userClientFor, bridgeClientFor } = build();
	const cli = bridgeClientFor({ tokenId: "tok-1", userId: ALICE.id });
	const { sessionId } = await cli.bridge.startSession({
		agentKind: AGENT_KIND,
	});
	await cli.bridge.pushEvents({
		sessionId,
		events: [{ i: 1 }, { i: 2 }, { i: 3 }],
	});

	const alice = userClientFor(ALICE);
	const all = await alice.bridge.history({ sessionId });
	expect(all).toHaveLength(3);

	const afterFirst = await alice.bridge.history({
		sessionId,
		afterSeq: all[0]?.seq ?? 0,
	});
	expect(afterFirst).toHaveLength(2);
	expect(afterFirst.map((row) => row.event)).toEqual([{ i: 2 }, { i: 3 }]);
});

it("pushEvents still succeeds live when message persistence fails", async () => {
	const { userClientFor, bridgeClientFor, services } = build();
	const cli = bridgeClientFor({ tokenId: "tok-1", userId: ALICE.id });
	const { sessionId } = await cli.bridge.startSession({
		agentKind: AGENT_KIND,
	});

	services.stores.bridgeMessage.appendMany = () =>
		Promise.reject(new Error("db unavailable"));

	await expect(
		cli.bridge.pushEvents({ sessionId, events: [{ ok: true }] })
	).resolves.toEqual({ ok: true });

	const alice = userClientFor(ALICE);
	const events = await alice.bridge.observe({ sessionId, afterId: 0 });
	expect(events).toHaveLength(1);
});
