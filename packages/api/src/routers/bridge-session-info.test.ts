import { expect, it } from "vitest";
import { AGENT_KIND, ALICE, build } from "./bridge-test-helpers";

// The SDK can SET a model/permission mode but never READ one back, so the only
// truth about what a session runs is what the CLI puts on the wire. These
// specs pin that ingest persists it onto the session row, which is what
// `tasks.resume` later seeds the next run's startup config from (tasks-resume
// .ts) — without it a resumed session's composer has no selected value until
// the user sends a turn.

async function startSession() {
	const rig = build();
	const cli = rig.bridgeClientFor({ tokenId: "tok-1", userId: ALICE.id });
	const { sessionId } = await cli.bridge.startSession({
		agentKind: AGENT_KIND,
	});
	return { ...rig, cli, sessionId };
}

it("pushEvents records model and permissionMode off session_ready", async () => {
	const { bridgeSession, cli, sessionId } = await startSession();
	const before = await bridgeSession.get(sessionId);
	expect(before?.lastModel).toBeNull();

	await cli.bridge.pushEvents({
		sessionId,
		events: [
			{
				kind: "status",
				status: "session_ready",
				detail: { model: "sonnet", permissionMode: "plan" },
			},
		],
	});

	const row = await bridgeSession.get(sessionId);
	expect(row?.lastModel).toBe("sonnet");
	expect(row?.lastPermissionMode).toBe("plan");
});

it("a later read-back wins per field, leaving the other field intact", async () => {
	const { bridgeSession, cli, sessionId } = await startSession();

	await cli.bridge.pushEvents({
		sessionId,
		events: [
			{
				kind: "status",
				status: "session_ready",
				detail: { model: "sonnet", permissionMode: "plan" },
			},
			{ kind: "status", status: "model_changed", detail: { model: "opus" } },
			{
				kind: "status",
				status: "permission_mode_changed",
				detail: { permissionMode: "acceptEdits" },
			},
		],
	});

	const row = await bridgeSession.get(sessionId);
	expect(row?.lastModel).toBe("opus");
	expect(row?.lastPermissionMode).toBe("acceptEdits");
});

it("ignores unrelated events and details carrying neither field", async () => {
	const { bridgeSession, cli, sessionId } = await startSession();

	await cli.bridge.pushEvents({
		sessionId,
		events: [
			{ kind: "message", role: "assistant", text: "hi" },
			// A handshake before the SDK reported anything: must not blank the row.
			{ kind: "status", status: "session_ready", detail: { cwd: "/tmp" } },
		],
	});

	const row = await bridgeSession.get(sessionId);
	expect(row?.lastModel).toBeNull();
	expect(row?.lastPermissionMode).toBeNull();
});

it("pushEvents still succeeds live when setLastSessionInfo fails", async () => {
	const { bridgeClientFor, services } = build();
	const cli = bridgeClientFor({ tokenId: "tok-1", userId: ALICE.id });
	const { sessionId } = await cli.bridge.startSession({
		agentKind: AGENT_KIND,
	});
	services.stores.bridgeSession.setLastSessionInfo = () =>
		Promise.reject(new Error("db down"));

	await expect(
		cli.bridge.pushEvents({
			sessionId,
			events: [
				{
					kind: "status",
					status: "session_ready",
					detail: { model: "sonnet" },
				},
			],
		})
	).resolves.toBeDefined();
});
