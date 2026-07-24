import { expect, it } from "vitest";
import { ALICE, BOB, buildComputerRig } from "./computers-test-helpers";
import { pairComputer } from "./runs-test-helpers";

// P2-3a: pty.createSession — the session↔computer binding. It authorizes the
// computer (and optional project) for the caller and resolves the spawn spec;
// it mints a sessionId but stores no PTY state (the pty's own liveness is the
// run state). See routers/pty.ts.

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NOT_FOUND_RE = /not found/i;
const NOT_CLONED_RE = /isn't cloned/i;

it("mints a sessionId and resolves the runtime binary for a home terminal", async () => {
	const rig = buildComputerRig();
	const { computerId } = await pairComputer(rig, ALICE);

	const result = await rig.userClientFor(ALICE).pty.createSession({
		agentKind: "claude-code",
		computerId,
	});

	expect(result.command).toBe("claude");
	expect(result.args).toEqual([]);
	expect(result.cwd).toBe("");
	expect(result.computerId).toBe(computerId);
	expect(result.sessionId).toMatch(UUID_RE);
});

it("rejects a computer the caller doesn't own", async () => {
	const rig = buildComputerRig();
	const { computerId } = await pairComputer(rig, ALICE);

	await expect(
		rig.userClientFor(BOB).pty.createSession({
			agentKind: "claude-code",
			computerId,
		})
	).rejects.toThrow(NOT_FOUND_RE);
});

it("resolves cwd to a ready project's localPath", async () => {
	const rig = buildComputerRig();
	const { client, computerId } = await pairComputer(rig, ALICE);
	const localPath = "/Users/alice/.better-agent/projects/abcd1234-x";
	const project = await rig.userClientFor(ALICE).projects.create({
		computerId,
		name: "X",
		repoFullName: "acme/x",
		token: undefined,
	});
	await client().projects.ackClone({ projectId: project.id });
	await client().projects.reportCloneResult({
		localPath,
		projectId: project.id,
		status: "ready",
	});

	const result = await rig.userClientFor(ALICE).pty.createSession({
		agentKind: "claude-code",
		computerId,
		projectId: project.id,
	});

	expect(result.cwd).toBe(localPath);
});

it("rejects a project that isn't cloned yet", async () => {
	const rig = buildComputerRig();
	const { computerId } = await pairComputer(rig, ALICE);
	const project = await rig.userClientFor(ALICE).projects.create({
		computerId,
		name: "X",
		repoFullName: "acme/x",
		token: undefined,
	});

	await expect(
		rig.userClientFor(ALICE).pty.createSession({
			agentKind: "claude-code",
			computerId,
			projectId: project.id,
		})
	).rejects.toThrow(NOT_CLONED_RE);
});
