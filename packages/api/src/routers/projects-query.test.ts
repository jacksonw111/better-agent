import type { ProjectQueryCommand } from "@better-agent/agent/project-ports";
import { expect, it, vi } from "vitest";
import { ALICE, BOB, buildComputerRig } from "./computers-test-helpers";
import { pairComputer, type Rig } from "./runs-test-helpers";

// Q2: the read-only project query loop — park → WS frame → computer submit →
// parked call wakes with the result. Pure real-time: no live control socket
// fails fast, an unanswered query times out, and late/foreign answers are
// idempotent ok:false.

const FS_RESULT = {
	entries: [
		{ kind: "dir" as const, name: "src" },
		{ kind: "file" as const, name: "README.md", size: 12 },
	],
};

type ComputerClient = () => ReturnType<Rig["computerClientFor"]>;

async function readyProject(
	rig: Rig,
	computerId: string,
	client: ComputerClient
) {
	const project = await rig
		.userClientFor(ALICE)
		.projects.create({ computerId, name: "App", repoFullName: "acme/app" });
	await client().projects.ackClone({ projectId: project.id });
	await client().projects.reportCloneResult({
		localPath: "/home/alice/.better-agent/projects/12345678-app",
		projectId: project.id,
		status: "ready",
	});
	return project;
}

/** Registers a live fake control socket and returns the project_query frames
 * it receives — clone_project pushes from notifyComputer are not the loop
 * under test here and are ignored. */
function connectSocket(rig: Rig, computerId: string) {
	const frames: ProjectQueryCommand[] = [];
	rig.computerControl.register(computerId, {
		send: (data: string) => {
			const frame = JSON.parse(data) as ProjectQueryCommand;
			if (frame.kind === "project_query") {
				frames.push(frame);
			}
		},
	});
	return frames;
}

function queryRig(options?: { projectQueryTimeoutMs?: number }) {
	return buildComputerRig(options);
}

it("round-trips an fs_list query through the computer", async () => {
	const rig = queryRig();
	const { client, computerId } = await pairComputer(rig, ALICE);
	const project = await readyProject(rig, computerId, client);
	const frames = connectSocket(rig, computerId);

	const pending = rig
		.userClientFor(ALICE)
		.projects.query({ op: "fs_list", path: "src", projectId: project.id });
	await vi.waitFor(() => {
		expect(frames).toHaveLength(1);
	});
	expect(frames[0]).toMatchObject({
		kind: "project_query",
		op: "fs_list",
		path: "src",
		projectId: project.id,
	});
	const submitted = await client().projects.submitQueryResult({
		ok: true,
		requestId: frames[0]?.requestId ?? "",
		result: FS_RESULT,
	});
	expect(submitted).toEqual({ ok: true });
	await expect(pending).resolves.toEqual(FS_RESULT);
});

it("relays the CLI's execution error verbatim as BAD_REQUEST", async () => {
	const rig = queryRig();
	const { client, computerId } = await pairComputer(rig, ALICE);
	const project = await readyProject(rig, computerId, client);
	const frames = connectSocket(rig, computerId);

	const pending = rig
		.userClientFor(ALICE)
		.projects.query({ op: "git_status", projectId: project.id });
	pending.catch(() => undefined);
	await vi.waitFor(() => {
		expect(frames).toHaveLength(1);
	});
	await client().projects.submitQueryResult({
		errorMessage: "git status failed: not a git repository",
		ok: false,
		requestId: frames[0]?.requestId ?? "",
	});
	await expect(pending).rejects.toMatchObject({
		code: "BAD_REQUEST",
		message: "git status failed: not a git repository",
	});
});

it("fails fast when the computer has no live control socket", async () => {
	const rig = queryRig();
	const { client, computerId } = await pairComputer(rig, ALICE);
	const project = await readyProject(rig, computerId, client);

	await expect(
		rig
			.userClientFor(ALICE)
			.projects.query({ op: "git_status", projectId: project.id })
	).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
});

it("gates on ownership and readiness before any push", async () => {
	const rig = queryRig();
	const { client, computerId } = await pairComputer(rig, ALICE);
	const created = await rig
		.userClientFor(ALICE)
		.projects.create({ computerId, name: "App", repoFullName: "acme/app" });
	const frames = connectSocket(rig, computerId);

	// Still `created` — not ready, nothing to query.
	await expect(
		rig
			.userClientFor(ALICE)
			.projects.query({ op: "git_status", projectId: created.id })
	).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

	const project = await readyProject(rig, computerId, client);
	await expect(
		rig
			.userClientFor(BOB)
			.projects.query({ op: "git_status", projectId: project.id })
	).rejects.toMatchObject({ code: "NOT_FOUND" });
	expect(frames).toHaveLength(0);
});

it("rejects escaping paths and a path on git_status server-side", async () => {
	const rig = queryRig();
	const { client, computerId } = await pairComputer(rig, ALICE);
	const project = await readyProject(rig, computerId, client);
	const frames = connectSocket(rig, computerId);
	const user = rig.userClientFor(ALICE);

	for (const path of ["../secrets", "a/../../b", "/etc/passwd", "..\\up"]) {
		await expect(
			user.projects.query({ op: "fs_list", path, projectId: project.id })
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	}
	await expect(
		user.projects.query({
			op: "git_status",
			path: "src",
			projectId: project.id,
		})
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
	expect(frames).toHaveLength(0);
});

it("times out an unanswered query and refuses the late answer", async () => {
	const rig = queryRig({ projectQueryTimeoutMs: 10 });
	const { client, computerId } = await pairComputer(rig, ALICE);
	const project = await readyProject(rig, computerId, client);
	const frames = connectSocket(rig, computerId);

	await expect(
		rig
			.userClientFor(ALICE)
			.projects.query({ op: "fs_list", projectId: project.id })
	).rejects.toMatchObject({ code: "TIMEOUT" });
	// The late answer is an idempotent ok:false, never an error.
	expect(
		await client().projects.submitQueryResult({
			ok: true,
			requestId: frames[0]?.requestId ?? "",
			result: FS_RESULT,
		})
	).toEqual({ ok: false });
});

it("refuses an answer signed by a different computer", async () => {
	const rig = queryRig();
	const { client, computerId } = await pairComputer(rig, ALICE);
	const project = await readyProject(rig, computerId, client);
	const frames = connectSocket(rig, computerId);
	const other = await pairComputer(rig, ALICE);

	const pending = rig
		.userClientFor(ALICE)
		.projects.query({ op: "fs_list", projectId: project.id });
	await vi.waitFor(() => {
		expect(frames).toHaveLength(1);
	});
	const requestId = frames[0]?.requestId ?? "";
	expect(
		await other
			.client()
			.projects.submitQueryResult({ ok: true, requestId, result: FS_RESULT })
	).toEqual({ ok: false });
	// The right computer can still answer afterwards.
	await client().projects.submitQueryResult({
		ok: true,
		requestId,
		result: FS_RESULT,
	});
	await expect(pending).resolves.toEqual(FS_RESULT);
});
