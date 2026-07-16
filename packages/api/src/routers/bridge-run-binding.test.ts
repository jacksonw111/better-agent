import { createRunSessionCredential } from "@better-agent/agent/task/run-session-credential";
import { expect, it } from "vitest";
import { AGENT_KIND, ALICE, build } from "./bridge-test-helpers";

// S2-T2: startSession's optional runId (D4). A Run's pre-issued session
// credential starts the session with `runId`, which binds both directions —
// bridge_sessions.run_id at creation, runs.session_id right after — while
// runId-less calls (every pre-existing CLI flow) stay byte-identical.

type Rig = ReturnType<typeof build>;

/** Mints a Run session credential and a matching created Run, exactly as
 * S2-T3's tasks.create will (fake stores don't validate FKs, so the task and
 * computer ids can be plain uuids here). */
async function seedRunWithCredential(rig: Rig) {
	const credential = await createRunSessionCredential({
		bridgeTokenStore: rig.bridgeToken,
	})({ agentKind: AGENT_KIND, taskId: "task-1", userId: ALICE.id });
	const run = await rig.run.insert({
		agentKind: AGENT_KIND,
		branch: null,
		computerId: crypto.randomUUID(),
		issueSnapshots: [],
		launchKey: crypto.randomUUID(),
		sessionTokenId: credential.tokenId,
		taskId: "task-1",
		workspaceKind: "standalone",
	});
	return { credential, run };
}

it("startSession with runId binds the session and the run to each other", async () => {
	const rig = build();
	const { credential, run } = await seedRunWithCredential(rig);
	const cli = rig.bridgeClientFor({
		tokenId: credential.tokenId,
		userId: ALICE.id,
	});

	const { sessionId } = await cli.bridge.startSession({
		agentKind: AGENT_KIND,
		runId: run.id,
	});

	expect((await rig.bridgeSession.get(sessionId))?.runId).toBe(run.id);
	expect(rig.run.rows.get(run.id)?.sessionId).toBe(sessionId);
});

it("rejects a runId when the token is not that run's session credential", async () => {
	const rig = build();
	const { run } = await seedRunWithCredential(rig);
	const cli = rig.bridgeClientFor({
		tokenId: "some-other-token",
		userId: ALICE.id,
	});

	await expect(
		cli.bridge.startSession({ agentKind: AGENT_KIND, runId: run.id })
	).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	expect(rig.run.rows.get(run.id)?.sessionId).toBeNull();
});

it("rejects an unknown runId", async () => {
	const rig = build();
	const { credential } = await seedRunWithCredential(rig);
	const cli = rig.bridgeClientFor({
		tokenId: credential.tokenId,
		userId: ALICE.id,
	});
	await expect(
		cli.bridge.startSession({
			agentKind: AGENT_KIND,
			runId: crypto.randomUUID(),
		})
	).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});

it("startSession without runId behaves exactly as before: no bindings", async () => {
	const rig = build();
	const { run } = await seedRunWithCredential(rig);
	const cli = rig.bridgeClientFor({ tokenId: "tok-1", userId: ALICE.id });

	const { sessionId } = await cli.bridge.startSession({
		agentKind: AGENT_KIND,
	});

	expect((await rig.bridgeSession.get(sessionId))?.runId).toBeNull();
	expect(rig.run.rows.get(run.id)?.sessionId).toBeNull();
});
