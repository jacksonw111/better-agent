import type { WorkspaceQueryCommand } from "@better-agent/agent/project-ports";
import { expect, it, vi } from "vitest";
import { ALICE, BOB, buildComputerRig } from "./computers-test-helpers";
import { pairComputer, type Rig } from "./runs-test-helpers";

// DP-WS: the session-workspace query loop (pty.query) — park → workspace_query
// WS frame → computer submit → parked call wakes. Same real-time contract as
// the project loop: workspace root resolved from the session (project checkout
// vs home dir), a `shell` op on top of fs_list/git_status, no live socket fails
// fast, an unanswered query times out.

const FS_RESULT = {
	entries: [
		{ kind: "dir" as const, name: "src" },
		{ kind: "file" as const, name: "README.md", size: 12 },
	],
};

const SHELL_RESULT = {
	exitCode: 0,
	stderr: "",
	stdout: "hello\n",
	truncated: false,
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

function homeSession(rig: Rig, computerId: string) {
	return rig
		.userClientFor(ALICE)
		.pty.createSession({ agentKind: "claude-code", computerId });
}

/** Registers a live fake control socket and returns the workspace_query frames
 * it receives. */
function connectSocket(rig: Rig, computerId: string) {
	const frames: WorkspaceQueryCommand[] = [];
	rig.computerControl.register(computerId, {
		send: (data: string) => {
			const frame = JSON.parse(data) as WorkspaceQueryCommand;
			if (frame.kind === "workspace_query") {
				frames.push(frame);
			}
		},
	});
	return frames;
}

it("round-trips an fs_list query in a project session's checkout", async () => {
	const rig = buildComputerRig();
	const { client, computerId } = await pairComputer(rig, ALICE);
	const project = await readyProject(rig, computerId, client);
	const { sessionId } = await rig.userClientFor(ALICE).pty.createSession({
		agentKind: "claude-code",
		computerId,
		projectId: project.id,
	});
	const frames = connectSocket(rig, computerId);

	const pending = rig
		.userClientFor(ALICE)
		.pty.query({ op: "fs_list", path: "src", sessionId });
	await vi.waitFor(() => {
		expect(frames).toHaveLength(1);
	});
	expect(frames[0]).toMatchObject({
		kind: "workspace_query",
		op: "fs_list",
		path: "src",
		workspaceRoot: "/home/alice/.better-agent/projects/12345678-app",
	});
	await client().projects.submitQueryResult({
		ok: true,
		requestId: frames[0]?.requestId ?? "",
		result: FS_RESULT,
	});
	await expect(pending).resolves.toEqual(FS_RESULT);
});

it("resolves a project-less session to the home dir (empty root)", async () => {
	const rig = buildComputerRig();
	const { computerId } = await pairComputer(rig, ALICE);
	const { sessionId } = await homeSession(rig, computerId);
	const frames = connectSocket(rig, computerId);

	const pending = rig
		.userClientFor(ALICE)
		.pty.query({ op: "git_status", sessionId });
	pending.catch(() => undefined);
	await vi.waitFor(() => {
		expect(frames).toHaveLength(1);
	});
	expect(frames[0]).toMatchObject({ op: "git_status", workspaceRoot: "" });
});

it("round-trips a shell query", async () => {
	const rig = buildComputerRig();
	const { client, computerId } = await pairComputer(rig, ALICE);
	const { sessionId } = await homeSession(rig, computerId);
	const frames = connectSocket(rig, computerId);

	const pending = rig
		.userClientFor(ALICE)
		.pty.query({ cmd: "echo hello", op: "shell", sessionId });
	await vi.waitFor(() => {
		expect(frames).toHaveLength(1);
	});
	expect(frames[0]).toMatchObject({ cmd: "echo hello", op: "shell" });
	await client().projects.submitQueryResult({
		ok: true,
		requestId: frames[0]?.requestId ?? "",
		result: SHELL_RESULT,
	});
	await expect(pending).resolves.toEqual(SHELL_RESULT);
});

it("relays the CLI's execution error verbatim as BAD_REQUEST", async () => {
	const rig = buildComputerRig();
	const { client, computerId } = await pairComputer(rig, ALICE);
	const { sessionId } = await homeSession(rig, computerId);
	const frames = connectSocket(rig, computerId);

	const pending = rig
		.userClientFor(ALICE)
		.pty.query({ cmd: "false", op: "shell", sessionId });
	pending.catch(() => undefined);
	await vi.waitFor(() => {
		expect(frames).toHaveLength(1);
	});
	await client().projects.submitQueryResult({
		errorMessage: "command timed out",
		ok: false,
		requestId: frames[0]?.requestId ?? "",
	});
	await expect(pending).rejects.toMatchObject({
		code: "BAD_REQUEST",
		message: "command timed out",
	});
});

it("fails fast when the computer has no live control socket", async () => {
	const rig = buildComputerRig();
	const { computerId } = await pairComputer(rig, ALICE);
	const { sessionId } = await homeSession(rig, computerId);

	await expect(
		rig.userClientFor(ALICE).pty.query({ op: "git_status", sessionId })
	).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
});

it("gates on ownership and session status", async () => {
	const rig = buildComputerRig();
	const { computerId } = await pairComputer(rig, ALICE);
	const { sessionId } = await homeSession(rig, computerId);
	const frames = connectSocket(rig, computerId);

	await expect(
		rig.userClientFor(BOB).pty.query({ op: "git_status", sessionId })
	).rejects.toMatchObject({ code: "NOT_FOUND" });

	await rig.userClientFor(ALICE).pty.endSession({ sessionId });
	await expect(
		rig.userClientFor(ALICE).pty.query({ op: "git_status", sessionId })
	).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
	expect(frames).toHaveLength(0);
});

it("rejects escaping paths and misused op-specific inputs", async () => {
	const rig = buildComputerRig();
	const { computerId } = await pairComputer(rig, ALICE);
	const { sessionId } = await homeSession(rig, computerId);
	const frames = connectSocket(rig, computerId);
	const user = rig.userClientFor(ALICE);

	for (const path of ["../secrets", "a/../../b", "/etc/passwd", "..\\up"]) {
		await expect(
			user.pty.query({ op: "fs_list", path, sessionId })
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	}
	await expect(
		user.pty.query({ op: "git_status", path: "src", sessionId })
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
	await expect(
		user.pty.query({ op: "shell", sessionId })
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
	expect(frames).toHaveLength(0);
});

it("times out an unanswered query and refuses the late answer", async () => {
	const rig = buildComputerRig({ projectQueryTimeoutMs: 10 });
	const { client, computerId } = await pairComputer(rig, ALICE);
	const { sessionId } = await homeSession(rig, computerId);
	const frames = connectSocket(rig, computerId);

	await expect(
		rig.userClientFor(ALICE).pty.query({ op: "fs_list", sessionId })
	).rejects.toMatchObject({ code: "TIMEOUT" });
	expect(
		await client().projects.submitQueryResult({
			ok: true,
			requestId: frames[0]?.requestId ?? "",
			result: FS_RESULT,
		})
	).toEqual({ ok: false });
});

it("reports the workspace label + availability", async () => {
	const rig = buildComputerRig();
	const { client, computerId } = await pairComputer(rig, ALICE);
	const home = await homeSession(rig, computerId);
	expect(
		await rig.userClientFor(ALICE).pty.workspace({ sessionId: home.sessionId })
	).toEqual({ kind: "home", path: null, reason: null });

	const project = await readyProject(rig, computerId, client);
	const projectSession = await rig.userClientFor(ALICE).pty.createSession({
		agentKind: "claude-code",
		computerId,
		projectId: project.id,
	});
	expect(
		await rig
			.userClientFor(ALICE)
			.pty.workspace({ sessionId: projectSession.sessionId })
	).toMatchObject({
		kind: "project",
		path: "/home/alice/.better-agent/projects/12345678-app",
		reason: null,
	});
});
