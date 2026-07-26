import { expect, it } from "vitest";
import { AGENT_KIND, ALICE, BOB, build } from "./bridge-test-helpers";

// P3-T1: rename/star/archive/restore/hard-delete through the router against
// the in-memory stores/relay (same rig as bridge.test.ts). endSession's own
// coverage stays in bridge.test.ts.

async function startOne() {
	const rig = build();
	const cli = rig.bridgeClientFor({ tokenId: "tok-1", userId: ALICE.id });
	const { sessionId } = await cli.bridge.startSession({
		agentKind: AGENT_KIND,
	});
	return {
		...rig,
		cli,
		sessionId,
		alice: rig.userClientFor(ALICE),
		bob: rig.userClientFor(BOB),
	};
}

it("renameSession trims the name and persists it; empty clears back to null", async () => {
	const { alice, bridgeSession, sessionId } = await startOne();

	await alice.bridge.renameSession({ sessionId, name: "  repo work  " });
	expect((await bridgeSession.get(sessionId))?.name).toBe("repo work");

	await alice.bridge.renameSession({ sessionId, name: "   " });
	expect((await bridgeSession.get(sessionId))?.name).toBeNull();
});

it("renameSession with null clears the name and never touches label", async () => {
	const rig = build();
	const cli = rig.bridgeClientFor({ tokenId: "tok-1", userId: ALICE.id });
	const { sessionId } = await cli.bridge.startSession({
		agentKind: AGENT_KIND,
		label: "cli-label",
	});
	const alice = rig.userClientFor(ALICE);

	await alice.bridge.renameSession({ sessionId, name: "renamed" });
	await alice.bridge.renameSession({ sessionId, name: null });

	const row = await rig.bridgeSession.get(sessionId);
	expect(row?.name).toBeNull();
	expect(row?.label).toBe("cli-label");
});

it("starSession sets and clears the flag", async () => {
	const { alice, bridgeSession, sessionId } = await startOne();

	await alice.bridge.starSession({ sessionId, starred: true });
	expect((await bridgeSession.get(sessionId))?.starred).toBe(true);

	await alice.bridge.starSession({ sessionId, starred: false });
	expect((await bridgeSession.get(sessionId))?.starred).toBe(false);
});

it("archiving an ACTIVE session ends it and sends the stop control", async () => {
	const { alice, bridgeSession, services, sessionId } = await startOne();

	await alice.bridge.archiveSession({ sessionId });

	const row = await bridgeSession.get(sessionId);
	expect(row?.status).toBe("ended");
	expect(row?.archivedAt).toBeInstanceOf(Date);
	const commands = await services.relayStore.read(sessionId, "commands", 0);
	expect(commands[0]?.data).toEqual({ type: "control", action: "stop" });
});

it("archiving an already-ended session skips the stop control", async () => {
	const { alice, bridgeSession, services, sessionId } = await startOne();
	await alice.bridge.endSession({ sessionId });
	const afterEnd = await services.relayStore.read(sessionId, "commands", 0);

	await alice.bridge.archiveSession({ sessionId });

	expect((await bridgeSession.get(sessionId))?.archivedAt).toBeInstanceOf(Date);
	const commands = await services.relayStore.read(sessionId, "commands", 0);
	expect(commands).toHaveLength(afterEnd.length);
});

it("restoreSession clears archivedAt but keeps the session ended", async () => {
	const { alice, bridgeSession, sessionId } = await startOne();
	await alice.bridge.archiveSession({ sessionId });

	await alice.bridge.restoreSession({ sessionId });

	const row = await bridgeSession.get(sessionId);
	expect(row?.archivedAt).toBeNull();
	expect(row?.status).toBe("ended");
});

it("deleteSession hard-deletes the row and stops a still-active agent", async () => {
	const { alice, bridgeSession, services, sessionId } = await startOne();

	await alice.bridge.deleteSession({ sessionId });

	expect(await bridgeSession.get(sessionId)).toBeNull();
	expect((await alice.bridge.listSessions()).sessions).toHaveLength(0);
	// The stop control was appended before the delete; the relay window (and
	// the ownership cache) outlive the DB row, so the CLI's poll still sees it.
	const commands = await services.relayStore.read(sessionId, "commands", 0);
	expect(commands[0]?.data).toEqual({ type: "control", action: "stop" });
});

it("every management route rejects a non-owner with NOT_FOUND", async () => {
	const { bob, sessionId } = await startOne();

	await expect(
		bob.bridge.renameSession({ sessionId, name: "x" })
	).rejects.toMatchObject({ code: "NOT_FOUND" });
	await expect(
		bob.bridge.starSession({ sessionId, starred: true })
	).rejects.toMatchObject({ code: "NOT_FOUND" });
	await expect(bob.bridge.archiveSession({ sessionId })).rejects.toMatchObject({
		code: "NOT_FOUND",
	});
	await expect(bob.bridge.restoreSession({ sessionId })).rejects.toMatchObject({
		code: "NOT_FOUND",
	});
	await expect(bob.bridge.deleteSession({ sessionId })).rejects.toMatchObject({
		code: "NOT_FOUND",
	});
});
