import { COMPUTER_OFFLINE_AFTER_MS } from "@better-agent/agent/computer-ports";
import { expect, it } from "vitest";
import { ALICE, BOB, buildComputerRig } from "./computers-test-helpers";
import { pairComputer, type Rig } from "./runs-test-helpers";

// Q1: the Projects router — create queues an idempotent clone_project
// delivery ("queue IS the state", D4), ackClone/reportCloneResult drive the
// created→cloning→ready/error state machine, and no user-facing response
// ever carries a token (last4 only).

const RAW_TOKEN = "ghp_super_secret_repo_token";

function createInput(computerId: string) {
	return {
		computerId,
		name: "Better Agent",
		repoFullName: "acme/better-agent",
		token: RAW_TOKEN,
	};
}

type CreateOverrides = Partial<ReturnType<typeof createInput>> & {
	repoUrl?: string;
};

async function createProject(
	rig: Rig,
	computerId: string,
	overrides?: CreateOverrides
) {
	return await rig
		.userClientFor(ALICE)
		.projects.create({ ...createInput(computerId), ...overrides });
}

it("create queues one idempotent clone delivery with the decrypted token", async () => {
	const rig = buildComputerRig();
	const { client, computerId } = await pairComputer(rig, ALICE);

	const project = await createProject(rig, computerId);
	expect(project.status).toBe("created");

	const first = (await client().computers.heartbeat()).pendingCommands;
	const second = (await client().computers.heartbeat()).pendingCommands;
	expect(first).toEqual([
		{
			kind: "clone_project",
			projectId: project.id,
			repoCloneUrl: "https://github.com/acme/better-agent.git",
			token: RAW_TOKEN,
		},
	]);
	// Redelivery until acked — projectId is the idempotency key.
	expect(second).toEqual(first);

	await client().projects.ackClone({ projectId: project.id });
	expect((await client().computers.heartbeat()).pendingCommands).toEqual([]);
});

it("create accepts an https repoUrl on any host and omits token for public repos", async () => {
	const rig = buildComputerRig();
	const { client, computerId } = await pairComputer(rig, ALICE);

	const project = await createProject(rig, computerId, {
		repoFullName: undefined,
		repoUrl: "https://gitlab.example.com/group/sub/better-agent.git",
		token: undefined,
	});
	// The URL is stored verbatim; the display name is host-stripped, .git-less.
	expect(project.repoCloneUrl).toBe(
		"https://gitlab.example.com/group/sub/better-agent.git"
	);
	expect(project.repoFullName).toBe("group/sub/better-agent");
	expect(project.tokenLast4).toBeNull();

	const commands = (await client().computers.heartbeat()).pendingCommands;
	expect(commands).toHaveLength(1);
	expect(commands[0]).toMatchObject({
		repoCloneUrl: "https://gitlab.example.com/group/sub/better-agent.git",
	});
	// A token-less project's clone command omits the key entirely.
	expect(commands[0]).not.toHaveProperty("token");
});

it("create accepts an ssh repoUrl and derives the same display name", async () => {
	const rig = buildComputerRig();
	const { computerId } = await pairComputer(rig, ALICE);

	const project = await createProject(rig, computerId, {
		repoFullName: undefined,
		repoUrl: "git@git.company.io:group/sub/better-agent.git",
	});
	expect(project.repoCloneUrl).toBe(
		"git@git.company.io:group/sub/better-agent.git"
	);
	expect(project.repoFullName).toBe("group/sub/better-agent");
});

it("create rejects malformed git URLs and ambiguous repo inputs", async () => {
	const rig = buildComputerRig();
	const { computerId } = await pairComputer(rig, ALICE);
	const attempt = (overrides: Record<string, unknown>) =>
		createProject(rig, computerId, overrides as CreateOverrides);

	// Not https and not the ssh form.
	await expect(
		attempt({ repoFullName: undefined, repoUrl: "ftp://host/repo.git" })
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
	await expect(
		attempt({ repoFullName: undefined, repoUrl: "not a url" })
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
	// Exactly one of repoUrl/repoFullName — neither and both are rejected.
	await expect(
		attempt({ repoFullName: undefined, repoUrl: undefined })
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
	await expect(
		attempt({ repoUrl: "https://github.com/acme/other.git" })
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
	expect(rig.project.rows.size).toBe(0);
});

it("no user-facing response ever carries the token — last4 only", async () => {
	const rig = buildComputerRig();
	const { computerId } = await pairComputer(rig, ALICE);
	const client = rig.userClientFor(ALICE);

	const created = await createProject(rig, computerId);
	const listed = await client.projects.list({ computerId });
	const fetched = await client.projects.get({ projectId: created.id });

	for (const payload of [created, listed, fetched]) {
		const json = JSON.stringify(payload);
		expect(json).not.toContain(RAW_TOKEN);
		expect(json).not.toContain("encryptedToken");
	}
	// The last four characters of RAW_TOKEN — the only credential residue
	// a user-facing response may carry.
	expect(fetched.tokenLast4).toBe("oken");
	expect(listed).toEqual([fetched]);
});

it("create rejects a foreign computer and an offline computer", async () => {
	const rig = buildComputerRig();
	const { computerId } = await pairComputer(rig, ALICE);

	await expect(
		rig.userClientFor(BOB).projects.create(createInput(computerId))
	).rejects.toMatchObject({ code: "NOT_FOUND" });

	const row = rig.rows.get(computerId);
	if (row) {
		rig.rows.set(computerId, {
			...row,
			lastSeenAt: new Date(Date.now() - COMPUTER_OFFLINE_AFTER_MS - 1),
		});
	}
	await expect(
		rig.userClientFor(ALICE).projects.create(createInput(computerId))
	).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
	expect(rig.project.rows.size).toBe(0);
});

it("ackClone flips created→cloning once; a duplicate ack is ok:false", async () => {
	const rig = buildComputerRig();
	const { client, computerId } = await pairComputer(rig, ALICE);
	const project = await createProject(rig, computerId);

	expect(await client().projects.ackClone({ projectId: project.id })).toEqual({
		ok: true,
	});
	expect(rig.project.rows.get(project.id)?.status).toBe("cloning");
	expect(await client().projects.ackClone({ projectId: project.id })).toEqual({
		ok: false,
	});

	// Another computer (even the owner's) can never ack this project.
	const other = await pairComputer(rig, ALICE);
	await expect(
		other.client().projects.ackClone({ projectId: project.id })
	).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("reportCloneResult records ready+localPath and error+message", async () => {
	const rig = buildComputerRig();
	const { client, computerId } = await pairComputer(rig, ALICE);
	const localPath = "/Users/alice/.better-agent/projects/abcd1234-better-agent";

	const ready = await createProject(rig, computerId);
	await client().projects.ackClone({ projectId: ready.id });
	expect(
		await client().projects.reportCloneResult({
			localPath,
			projectId: ready.id,
			status: "ready",
		})
	).toEqual({ ok: true });
	const readyRow = rig.project.rows.get(ready.id);
	expect(readyRow?.status).toBe("ready");
	expect(readyRow?.localPath).toBe(localPath);

	const failed = await createProject(rig, computerId, { name: "Broken" });
	await client().projects.ackClone({ projectId: failed.id });
	expect(
		await client().projects.reportCloneResult({
			errorMessage: "fatal: could not read Username",
			projectId: failed.id,
			status: "error",
		})
	).toEqual({ ok: true });
	const failedRow = rig.project.rows.get(failed.id);
	expect(failedRow?.status).toBe("error");
	expect(failedRow?.errorMessage).toBe("fatal: could not read Username");
});

it("reportCloneResult accepts a lost-ack report but never reopens a settled one", async () => {
	const rig = buildComputerRig();
	const { client, computerId } = await pairComputer(rig, ALICE);
	const project = await createProject(rig, computerId);

	// The ack was lost but the clone finished: still recorded (created→ready).
	expect(
		await client().projects.reportCloneResult({
			localPath: "/tmp/checkout",
			projectId: project.id,
			status: "ready",
		})
	).toEqual({ ok: true });

	// ready/error are terminal: late duplicates are idempotent ok:false.
	expect(
		await client().projects.reportCloneResult({
			errorMessage: "late failure",
			projectId: project.id,
			status: "error",
		})
	).toEqual({ ok: false });
	expect(rig.project.rows.get(project.id)?.status).toBe("ready");
});

it("delete is owner-scoped and removes only the server-side row", async () => {
	const rig = buildComputerRig();
	const { computerId } = await pairComputer(rig, ALICE);
	const project = await createProject(rig, computerId);

	await expect(
		rig.userClientFor(BOB).projects.delete({ projectId: project.id })
	).rejects.toMatchObject({ code: "NOT_FOUND" });

	expect(
		await rig.userClientFor(ALICE).projects.delete({ projectId: project.id })
	).toEqual({ ok: true });
	expect(rig.project.rows.size).toBe(0);
});
