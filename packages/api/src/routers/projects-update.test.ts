import { COMPUTER_OFFLINE_AFTER_MS } from "@better-agent/agent/computer-ports";
import { expect, it } from "vitest";
import { ALICE, BOB, buildComputerRig } from "./computers-test-helpers";
import { pairComputer, type Rig } from "./runs-test-helpers";

// The user-plane Project edits: update (rename in place; a repo/token change
// re-encrypts/re-derives and resets the row to `created`, re-entering the D4
// clone-delivery queue) and retryClone (error → created, same re-queue). Both
// are owner-scoped, and a re-queue needs the computer online — a rename does
// not.

const RAW_TOKEN = "ghp_super_secret_repo_token";
const NEW_URL = "https://gitlab.example.com/group/sub/agent.git";

async function readyProject(rig: Rig, alice = ALICE) {
	const { client, computerId } = await pairComputer(rig, alice);
	const project = await rig.userClientFor(alice).projects.create({
		computerId,
		name: "Better Agent",
		repoFullName: "acme/better-agent",
		token: RAW_TOKEN,
	});
	await client().projects.ackClone({ projectId: project.id });
	await client().projects.reportCloneResult({
		localPath: "/Users/alice/.better-agent/projects/abcd1234-better-agent",
		projectId: project.id,
		status: "ready",
	});
	return { client, computerId, project };
}

async function erroredProject(rig: Rig) {
	const context = await readyProject(rig);
	const failed = await rig.userClientFor(ALICE).projects.create({
		computerId: context.computerId,
		name: "Broken",
		repoFullName: "acme/broken",
	});
	await context.client().projects.ackClone({ projectId: failed.id });
	await context.client().projects.reportCloneResult({
		errorMessage: "fatal: repository not found",
		projectId: failed.id,
		status: "error",
	});
	return { ...context, failed };
}

function goOffline(rig: Rig, computerId: string) {
	const row = rig.rows.get(computerId);
	if (row) {
		rig.rows.set(computerId, {
			...row,
			lastSeenAt: new Date(Date.now() - COMPUTER_OFFLINE_AFTER_MS - 1),
		});
	}
}

it("update renames in place without touching the clone state or the queue", async () => {
	const rig = buildComputerRig();
	const { client, project } = await readyProject(rig);

	const renamed = await rig
		.userClientFor(ALICE)
		.projects.update({ name: "Renamed", projectId: project.id });

	expect(renamed.name).toBe("Renamed");
	expect(renamed.status).toBe("ready");
	expect(renamed.localPath).toBe(
		"/Users/alice/.better-agent/projects/abcd1234-better-agent"
	);
	expect((await client().computers.heartbeat()).pendingCommands).toEqual([]);
});

it("update with a new repoUrl resets the clone state and re-queues delivery", async () => {
	const rig = buildComputerRig();
	const { client, project } = await readyProject(rig);

	const updated = await rig
		.userClientFor(ALICE)
		.projects.update({ projectId: project.id, repoUrl: NEW_URL });

	// New URL stored verbatim, display name re-derived, clone state reset.
	expect(updated.repoCloneUrl).toBe(NEW_URL);
	expect(updated.repoFullName).toBe("group/sub/agent");
	expect(updated.status).toBe("created");
	expect(updated.localPath).toBeNull();
	expect(updated.errorMessage).toBeNull();
	// Back in the delivery queue, carrying the UNCHANGED stored token.
	expect((await client().computers.heartbeat()).pendingCommands).toEqual([
		{
			kind: "clone_project",
			projectId: project.id,
			repoCloneUrl: NEW_URL,
			token: RAW_TOKEN,
		},
	]);
});

it("update with a new token re-encrypts it and the re-queued clone carries it", async () => {
	const rig = buildComputerRig();
	const { client, project } = await readyProject(rig);

	const updated = await rig
		.userClientFor(ALICE)
		.projects.update({ projectId: project.id, token: "glpat_new_value" });

	expect(updated.tokenLast4).toBe("alue");
	expect(updated.status).toBe("created");
	const commands = (await client().computers.heartbeat()).pendingCommands;
	expect(commands[0]).toMatchObject({ token: "glpat_new_value" });
	// No user-facing response ever carries the token itself.
	const json = JSON.stringify(updated);
	expect(json).not.toContain("glpat_new_value");
	expect(json).not.toContain("encryptedToken");
});

it("update is owner-scoped and validates its patch", async () => {
	const rig = buildComputerRig();
	const { project } = await readyProject(rig);
	const alice = rig.userClientFor(ALICE);

	await expect(
		rig
			.userClientFor(BOB)
			.projects.update({ name: "Stolen", projectId: project.id })
	).rejects.toMatchObject({ code: "NOT_FOUND" });
	// An empty patch and a malformed git URL are both rejected up front.
	await expect(
		alice.projects.update({ projectId: project.id })
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
	await expect(
		alice.projects.update({ projectId: project.id, repoUrl: "not a url" })
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
	expect(rig.project.rows.get(project.id)?.name).toBe("Better Agent");
});

it("a repo/token update needs the computer online; a rename does not", async () => {
	const rig = buildComputerRig();
	const { computerId, project } = await readyProject(rig);
	goOffline(rig, computerId);
	const alice = rig.userClientFor(ALICE);

	await expect(
		alice.projects.update({ projectId: project.id, repoUrl: NEW_URL })
	).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
	expect(rig.project.rows.get(project.id)?.status).toBe("ready");

	const renamed = await alice.projects.update({
		name: "Offline rename",
		projectId: project.id,
	});
	expect(renamed.name).toBe("Offline rename");
});

it("retryClone re-queues a failed clone and clears the recorded error", async () => {
	const rig = buildComputerRig();
	const { client, failed } = await erroredProject(rig);

	const retried = await rig
		.userClientFor(ALICE)
		.projects.retryClone({ projectId: failed.id });

	expect(retried.status).toBe("created");
	expect(retried.errorMessage).toBeNull();
	const commands = (await client().computers.heartbeat()).pendingCommands;
	expect(commands).toContainEqual({
		kind: "clone_project",
		projectId: failed.id,
		repoCloneUrl: "https://github.com/acme/broken.git",
	});
});

it("retryClone rejects non-error projects, foreign callers and offline computers", async () => {
	const rig = buildComputerRig();
	const { computerId, failed, project } = await erroredProject(rig);
	const alice = rig.userClientFor(ALICE);

	// Only a FAILED clone can be retried — a ready checkout has nothing to redo.
	await expect(
		alice.projects.retryClone({ projectId: project.id })
	).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
	await expect(
		rig.userClientFor(BOB).projects.retryClone({ projectId: failed.id })
	).rejects.toMatchObject({ code: "NOT_FOUND" });

	goOffline(rig, computerId);
	await expect(
		alice.projects.retryClone({ projectId: failed.id })
	).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
	expect(rig.project.rows.get(failed.id)?.status).toBe("error");
});
