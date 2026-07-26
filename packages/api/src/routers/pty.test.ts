import { expect, it } from "vitest";
import { PtyFrameType } from "../pty/frame";
import { decodeFrame } from "../pty/frame-decode";
import { ALICE, BOB, buildComputerRig } from "./computers-test-helpers";
import { pairComputer } from "./runs-test-helpers";

// P2-3a → P25-A: pty.createSession now persists a stable session (the fix for
// "each open spawns a fresh pty and loses scrollback"). It authorizes the
// computer (and optional project), persists an active row, and returns the
// stable id + spawn spec — spawning nothing. listSessions/endSession/rename
// manage that persistent registry. See routers/pty.ts.

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NOT_FOUND_RE = /not found/i;
const NOT_CLONED_RE = /isn't cloned/i;
const SESSION_TITLE_RE = /^Session /;

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

it("persists the session so it shows up in listSessions (stable id)", async () => {
	const rig = buildComputerRig();
	const { computerId } = await pairComputer(rig, ALICE);
	const alice = rig.userClientFor(ALICE);

	const created = await alice.pty.createSession({
		agentKind: "claude-code",
		computerId,
	});
	const { sessions } = await alice.pty.listSessions({ computerId });
	expect(sessions.map((s) => s.sessionId)).toEqual([created.sessionId]);
	expect(sessions[0]?.status).toBe("active");
	expect(sessions[0]?.title).toMatch(SESSION_TITLE_RE);
	expect(sessions[0]?.agentKind).toBe("claude-code");
});

it("listSessions filters by project and hides ended sessions", async () => {
	const rig = buildComputerRig();
	const { client, computerId } = await pairComputer(rig, ALICE);
	const alice = rig.userClientFor(ALICE);
	const project = await alice.projects.create({
		computerId,
		name: "X",
		repoFullName: "acme/x",
		token: undefined,
	});
	await client().projects.ackClone({ projectId: project.id });
	await client().projects.reportCloneResult({
		localPath: "/Users/alice/.better-agent/projects/abcd1234-x",
		projectId: project.id,
		status: "ready",
	});

	const homeSession = await alice.pty.createSession({
		agentKind: "claude-code",
		computerId,
	});
	const projectSession = await alice.pty.createSession({
		agentKind: "claude-code",
		computerId,
		projectId: project.id,
	});

	const scoped = await alice.pty.listSessions({
		computerId,
		projectId: project.id,
	});
	expect(scoped.sessions.map((s) => s.sessionId)).toEqual([
		projectSession.sessionId,
	]);

	await alice.pty.endSession({ sessionId: homeSession.sessionId });
	const remaining = await alice.pty.listSessions({ computerId });
	expect(remaining.sessions.map((s) => s.sessionId)).toEqual([
		projectSession.sessionId,
	]);
});

it("endSession marks it ended and sends a KILL frame to the CLI", async () => {
	const rig = buildComputerRig();
	const { computerId } = await pairComputer(rig, ALICE);
	const alice = rig.userClientFor(ALICE);
	const created = await alice.pty.createSession({
		agentKind: "claude-code",
		computerId,
	});

	await alice.pty.endSession({ sessionId: created.sessionId });

	expect(rig.ptyKills).toHaveLength(1);
	const kill = rig.ptyKills[0];
	expect(kill?.computerId).toBe(computerId);
	const decoded = kill ? decodeFrame(kill.frame) : null;
	expect(decoded).toEqual({
		type: PtyFrameType.KILL,
		sessionId: created.sessionId,
	});
});

it("endSession rejects another user's session (no KILL leaks)", async () => {
	const rig = buildComputerRig();
	const { computerId } = await pairComputer(rig, ALICE);
	const created = await rig.userClientFor(ALICE).pty.createSession({
		agentKind: "claude-code",
		computerId,
	});
	await expect(
		rig.userClientFor(BOB).pty.endSession({ sessionId: created.sessionId })
	).rejects.toThrow(NOT_FOUND_RE);
	expect(rig.ptyKills).toHaveLength(0);
});

it("renameSession updates the title, owner-scoped", async () => {
	const rig = buildComputerRig();
	const { computerId } = await pairComputer(rig, ALICE);
	const alice = rig.userClientFor(ALICE);
	const created = await alice.pty.createSession({
		agentKind: "claude-code",
		computerId,
	});
	const renamed = await alice.pty.renameSession({
		sessionId: created.sessionId,
		title: "My build box",
	});
	expect(renamed.title).toBe("My build box");
	const { sessions } = await alice.pty.listSessions({ computerId });
	expect(sessions[0]?.title).toBe("My build box");
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
