import { expect, it } from "vitest";
import { AGENT_KIND, ALICE, build } from "./bridge-test-helpers";

// P2-T1: listSessions pagination + per-session attention, end-to-end through
// the router against the in-memory stores/relay (same rig as bridge.test.ts).

const STALE_MS = 6 * 60 * 1000;

async function startSessions(count: number) {
	const rig = build();
	const cli = rig.bridgeClientFor({ tokenId: "tok-1", userId: ALICE.id });
	const ids: string[] = [];
	for (let i = 0; i < count; i++) {
		const { sessionId } = await cli.bridge.startSession({
			agentKind: AGENT_KIND,
		});
		ids.push(sessionId);
	}
	return { ...rig, cli, ids, alice: rig.userClientFor(ALICE) };
}

it("returns all sessions and a null nextCursor when under the page size", async () => {
	const { alice, ids } = await startSessions(2);
	const page = await alice.bridge.listSessions();
	expect(page.sessions.map((s) => s.id).sort()).toEqual([...ids].sort());
	expect(page.nextCursor).toBeNull();
});

it("pages through with cursor: no overlap, no gaps, order preserved", async () => {
	const { alice } = await startSessions(3);
	const all = await alice.bridge.listSessions();

	const first = await alice.bridge.listSessions({ limit: 2 });
	expect(first.sessions).toHaveLength(2);
	expect(first.nextCursor).not.toBeNull();

	const second = await alice.bridge.listSessions({
		limit: 2,
		cursor: first.nextCursor ?? "",
	});
	const seen = [...first.sessions, ...second.sessions].map((s) => s.id);
	expect(seen).toEqual(all.sessions.map((s) => s.id));
	expect(new Set(seen).size).toBe(3);
});

it("an exactly-full page returns a cursor whose next page is empty", async () => {
	const { alice } = await startSessions(2);
	const first = await alice.bridge.listSessions({ limit: 2 });
	expect(first.nextCursor).not.toBeNull();

	const second = await alice.bridge.listSessions({
		cursor: first.nextCursor ?? "",
	});
	expect(second.sessions).toHaveLength(0);
	expect(second.nextCursor).toBeNull();
});

it("rejects a malformed cursor with BAD_REQUEST", async () => {
	const { alice } = await startSessions(1);
	await expect(
		alice.bridge.listSessions({ cursor: "not-a-cursor" })
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("rejects a limit above the cap", async () => {
	const { alice } = await startSessions(1);
	await expect(alice.bridge.listSessions({ limit: 101 })).rejects.toBeDefined();
});

it("scopes the page (and its cursor walk) to tokenId when given", async () => {
	const rig = build();
	const cliA = rig.bridgeClientFor({ tokenId: "tok-a", userId: ALICE.id });
	const cliB = rig.bridgeClientFor({ tokenId: "tok-b", userId: ALICE.id });
	const aIds: string[] = [];
	for (let i = 0; i < 3; i++) {
		const { sessionId } = await cliA.bridge.startSession({
			agentKind: AGENT_KIND,
		});
		aIds.push(sessionId);
		await cliB.bridge.startSession({ agentKind: AGENT_KIND });
	}
	const alice = rig.userClientFor(ALICE);

	const first = await alice.bridge.listSessions({ limit: 2, tokenId: "tok-a" });
	expect(first.sessions).toHaveLength(2);
	expect(first.sessions.every((s) => s.tokenId === "tok-a")).toBe(true);

	const second = await alice.bridge.listSessions({
		cursor: first.nextCursor ?? "",
		tokenId: "tok-a",
	});
	const seen = [...first.sessions, ...second.sessions].map((s) => s.id);
	expect(seen.sort()).toEqual([...aIds].sort());
});

it("excludes archived sessions by default; archived: true returns ONLY them", async () => {
	const { alice, ids } = await startSessions(3);
	const archivedId = ids[1] ?? "";
	await alice.bridge.archiveSession({ sessionId: archivedId });

	const defaults = await alice.bridge.listSessions();
	expect(defaults.sessions.map((s) => s.id)).not.toContain(archivedId);
	expect(defaults.sessions).toHaveLength(2);

	const archived = await alice.bridge.listSessions({ archived: true });
	expect(archived.sessions.map((s) => s.id)).toEqual([archivedId]);
	expect(archived.sessions[0]?.archivedAt).not.toBeNull();
});

it("cursor paging works within the archived view", async () => {
	const { alice, ids } = await startSessions(3);
	for (const sessionId of ids) {
		await alice.bridge.archiveSession({ sessionId });
	}

	const first = await alice.bridge.listSessions({ archived: true, limit: 2 });
	expect(first.sessions).toHaveLength(2);
	expect(first.nextCursor).not.toBeNull();

	const second = await alice.bridge.listSessions({
		archived: true,
		cursor: first.nextCursor ?? "",
	});
	const seen = [...first.sessions, ...second.sessions].map((s) => s.id);
	expect(seen.sort()).toEqual([...ids].sort());
});

it("rows carry name/starred/archivedAt for the web", async () => {
	const { alice, ids } = await startSessions(1);
	const sessionId = ids[0] ?? "";
	await alice.bridge.renameSession({ sessionId, name: "pinned work" });
	await alice.bridge.starSession({ sessionId, starred: true });

	const { sessions } = await alice.bridge.listSessions();
	expect(sessions[0]?.name).toBe("pinned work");
	expect(sessions[0]?.starred).toBe(true);
	expect(sessions[0]?.archivedAt).toBeNull();
});

it("flags an unanswered approval as attention: 'approval'", async () => {
	const { alice, cli, ids } = await startSessions(1);
	await cli.bridge.pushEvents({
		sessionId: ids[0] ?? "",
		events: [
			{
				kind: "approval",
				requestId: "req-1",
				title: "Run?",
				options: [{ id: "yes", label: "Yes" }],
			},
		],
	});
	const { sessions } = await alice.bridge.listSessions();
	expect(sessions[0]?.attention).toBe("approval");
});

it("an answered approval stops flagging 'approval'", async () => {
	const { alice, cli, ids } = await startSessions(1);
	const sessionId = ids[0] ?? "";
	await cli.bridge.pushEvents({
		sessionId,
		events: [
			{
				kind: "approval",
				requestId: "req-1",
				title: "Run?",
				options: [{ id: "yes", label: "Yes" }],
			},
		],
	});
	await alice.bridge.sendInput({
		sessionId,
		data: { type: "approval", requestId: "req-1", optionId: "yes" },
	});
	const { sessions } = await alice.bridge.listSessions();
	expect(sessions[0]?.attention).toBeNull();
});

it("flags an in-flight turn (trailing user message) as 'processing'", async () => {
	const { alice, cli, ids } = await startSessions(1);
	await cli.bridge.pushEvents({
		sessionId: ids[0] ?? "",
		events: [{ kind: "message", role: "user", text: "go" }],
	});
	const { sessions } = await alice.bridge.listSessions();
	expect(sessions[0]?.attention).toBe("processing");
});

it("an ended session never reports attention, even with in-flight-looking events", async () => {
	const { alice, cli, ids } = await startSessions(1);
	const sessionId = ids[0] ?? "";
	await cli.bridge.pushEvents({
		sessionId,
		events: [{ kind: "message", role: "user", text: "go" }],
	});
	await alice.bridge.endSession({ sessionId });
	const { sessions } = await alice.bridge.listSessions();
	expect(sessions[0]?.attention).toBeNull();
});

it("a session not seen recently gets attention: null without a relay read", async () => {
	const { alice, cli, ids, services } = await startSessions(1);
	const sessionId = ids[0] ?? "";
	await cli.bridge.pushEvents({
		sessionId,
		events: [{ kind: "message", role: "user", text: "go" }],
	});
	// Back-date lastSeenAt past the recency window (the store has no setter, so
	// intercept the page read) and make any relay read blow up — proving the
	// stale row short-circuits before touching the relay.
	const { listPageByUser } = services.stores.bridgeSession;
	services.stores.bridgeSession.listPageByUser = async (userId, opts) => {
		const rows = await listPageByUser(userId, opts);
		return rows.map((row) => ({
			...row,
			lastSeenAt: new Date(Date.now() - STALE_MS),
		}));
	};
	services.relayStore.readTail = () =>
		Promise.reject(new Error("must not be read"));
	const { sessions } = await alice.bridge.listSessions();
	expect(sessions[0]?.attention).toBeNull();
});

it("a relay failure degrades to attention: null instead of failing the list", async () => {
	const { alice, services } = await startSessions(1);
	services.relayStore.readTail = () =>
		Promise.reject(new Error("relay unavailable"));
	const { sessions, nextCursor } = await alice.bridge.listSessions();
	expect(sessions).toHaveLength(1);
	expect(sessions[0]?.attention).toBeNull();
	expect(nextCursor).toBeNull();
});
