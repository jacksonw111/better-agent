import type { ComputerPendingCommand } from "@better-agent/agent/computer-ports";
import type { ProjectStatus } from "@better-agent/agent/project-ports";
import { expect, it } from "vitest";
import { ALICE, buildComputerRig } from "./computers-test-helpers";
import {
	CLAUDE_ONLY_INVENTORY,
	pairComputer,
	type Rig,
} from "./runs-test-helpers";

// Q1: project sessions — tasks.create with a projectId runs inside the
// Project's long-lived checkout: the run's workspaceKind is "project" and the
// launch payload's workspace intent carries the projectId ONLY (the client
// resolves the path locally). Only a `ready` Project on the SAME computer can
// host a session.

const LOCAL_PATH = "/Users/alice/.better-agent/projects/abcd1234-better-agent";

async function seedProject(
	rig: Rig,
	computerId: string,
	status: ProjectStatus = "ready"
) {
	const project = await rig.project.insert({
		computerId,
		encryptedToken: null,
		name: "Better Agent",
		repoCloneUrl: "https://github.com/acme/better-agent.git",
		repoFullName: "acme/better-agent",
		tokenLast4: null,
		userId: ALICE.id,
	});
	if (status !== "created") {
		await rig.project.updateStatus(project.id, {
			localPath: status === "ready" ? LOCAL_PATH : null,
			status,
		});
	}
	return project;
}

async function pairClaudeComputer(rig: Rig) {
	return await pairComputer(rig, ALICE, {
		runtimeInventory: CLAUDE_ONLY_INVENTORY,
	});
}

function createInput(computerId: string, projectId: string) {
	return {
		agentKind: "claude-code" as const,
		computerId,
		description: "Refactor the auth module",
		name: "Auth refactor",
		projectId,
	};
}

function launchCommands(commands: ComputerPendingCommand[]) {
	return commands.filter((command) => command.kind === "launch");
}

it("a ready project yields a project run whose launch carries the projectId only", async () => {
	const rig = buildComputerRig();
	const { client, computerId } = await pairClaudeComputer(rig);
	const project = await seedProject(rig, computerId);

	const { runId, taskId } = await rig
		.userClientFor(ALICE)
		.tasks.create(createInput(computerId, project.id));

	expect(rig.task.rows.get(taskId)?.projectId).toBe(project.id);
	expect(rig.run.rows.get(runId)?.workspaceKind).toBe("project");

	const commands = launchCommands(
		(await client().computers.heartbeat()).pendingCommands
	);
	expect(commands).toHaveLength(1);
	expect(commands[0]?.workspace).toEqual({
		kind: "project",
		projectId: project.id,
	});
	// The payload never carries the checkout path — client-resolved only.
	expect(JSON.stringify(commands[0])).not.toContain(LOCAL_PATH);
});

it("rejects a project that is not ready, leaving no rows", async () => {
	const rig = buildComputerRig();
	const { computerId } = await pairClaudeComputer(rig);

	for (const status of ["created", "cloning", "error"] as const) {
		const project = await seedProject(rig, computerId, status);
		await expect(
			rig.userClientFor(ALICE).tasks.create(createInput(computerId, project.id))
		).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
	}
	expect(rig.task.rows.size).toBe(0);
	expect(rig.run.rows.size).toBe(0);
});

it("rejects a project on a different computer and an unknown/foreign project", async () => {
	const rig = buildComputerRig();
	const { computerId } = await pairClaudeComputer(rig);
	const other = await pairClaudeComputer(rig);
	const elsewhere = await seedProject(rig, other.computerId);

	await expect(
		rig.userClientFor(ALICE).tasks.create(createInput(computerId, elsewhere.id))
	).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

	await expect(
		rig
			.userClientFor(ALICE)
			.tasks.create(
				createInput(computerId, "00000000-0000-4000-8000-000000000000")
			)
	).rejects.toMatchObject({ code: "NOT_FOUND" });
	expect(rig.task.rows.size).toBe(0);
});

it("rejects combining projectId with repositoryFullName", async () => {
	const rig = buildComputerRig();
	const { computerId } = await pairClaudeComputer(rig);
	const project = await seedProject(rig, computerId);

	await expect(
		rig.userClientFor(ALICE).tasks.create({
			...createInput(computerId, project.id),
			repositoryFullName: "acme/other",
		})
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
	expect(rig.task.rows.size).toBe(0);
});

it("resume appends a new project run with the same project workspace intent", async () => {
	const rig = buildComputerRig();
	const { client, computerId } = await pairClaudeComputer(rig);
	const project = await seedProject(rig, computerId);
	const userClient = rig.userClientFor(ALICE);

	const { runId, taskId } = await userClient.tasks.create(
		createInput(computerId, project.id)
	);
	await client().runs.ackLaunch({ runId });
	await rig.run.updateStatus(runId, { status: "completed" });

	const resumed = await userClient.tasks.resume({ taskId });
	expect(resumed.runId).not.toBe(runId);
	expect(rig.run.rows.get(resumed.runId)?.workspaceKind).toBe("project");

	const commands = launchCommands(
		(await client().computers.heartbeat()).pendingCommands
	);
	expect(commands).toHaveLength(1);
	expect(commands[0]?.workspace).toEqual({
		kind: "project",
		projectId: project.id,
	});
});

it("heartbeat merges clone and launch deliveries, clones first", async () => {
	const rig = buildComputerRig();
	const { client, computerId } = await pairClaudeComputer(rig);
	// A still-created project (clone pending) alongside a stand-alone session.
	const pending = await seedProject(rig, computerId, "created");
	await rig.userClientFor(ALICE).tasks.create({
		agentKind: "claude-code",
		computerId,
		description: "Write release notes",
	});

	const commands = (await client().computers.heartbeat()).pendingCommands;
	expect(commands.map((command) => command.kind)).toEqual([
		"clone_project",
		"launch",
	]);
	expect(commands[0]).toMatchObject({ projectId: pending.id });

	// Each queue drains independently and idempotently.
	await client().projects.ackClone({ projectId: pending.id });
	const after = (await client().computers.heartbeat()).pendingCommands;
	expect(after.map((command) => command.kind)).toEqual(["launch"]);
});
