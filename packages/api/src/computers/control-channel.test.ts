import type {
	ComputerPendingCommand,
	ComputerRow,
} from "@better-agent/agent/computer-ports";
import { createSecretBox } from "@better-agent/agent/crypto/secret-box";
import { createRunSessionCredential } from "@better-agent/agent/task/run-session-credential";
import { createFakeProjectStore } from "@better-agent/agent/testing/fake-project-store";
import {
	createFakeRunStore,
	createFakeTaskStore,
} from "@better-agent/agent/testing/fake-task-stores";
import { expect, it } from "vitest";
import { memoryBridgeTokenStore } from "../routers/bridge-test-helpers-stores";
import {
	type ComputerControlSocket,
	createComputerControlChannel,
} from "./control-channel";

// S2-T2: the computer control channel's in-memory registry + push path.
// notifyComputer re-reads the created-runs queue every time, so redelivery
// after a reconnect can only ever contain still-unacked runs (§15.3).

const COMPUTER_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "alice-uid";
const DELIVERED_TWICE = 2;

function fakeSocket() {
	const sent: ComputerPendingCommand[] = [];
	const socket: ComputerControlSocket = {
		send: (data) => sent.push(JSON.parse(data) as ComputerPendingCommand),
	};
	return { sent, socket };
}

function buildChannelRig() {
	const run = createFakeRunStore();
	const task = createFakeTaskStore();
	const project = createFakeProjectStore();
	const secretBox = createSecretBox("control-channel-secret-32-chars!");
	const bridgeToken = memoryBridgeTokenStore(
		new Map(),
		new Map(),
		() => undefined
	);
	const computerRow = {
		id: COMPUTER_ID,
		userId: USER_ID,
	} as ComputerRow;
	const channel = createComputerControlChannel({
		bridgeToken,
		computer: {
			getById: (id) => Promise.resolve(id === COMPUTER_ID ? computerRow : null),
		},
		project,
		run,
		secretBox,
		task,
	});
	return { bridgeToken, channel, project, run, secretBox, task };
}

type ChannelRig = ReturnType<typeof buildChannelRig>;

async function seedCreatedRun(rig: ChannelRig) {
	const task = await rig.task.insert({
		userId: USER_ID,
		computerId: COMPUTER_ID,
		agentKind: "claude-code",
		name: "Fix login flake",
		description: "Fix the flaky login test",
		openingMessage: "Fix the flaky login test",
		repositoryCloneUrl: null,
		repositoryDefaultBranch: null,
		repositoryFullName: null,
		repositoryUrl: null,
	});
	const credential = await createRunSessionCredential({
		bridgeTokenStore: rig.bridgeToken,
	})({ agentKind: "claude-code", taskId: task.id, userId: USER_ID });
	return rig.run.insert({
		agentKind: "claude-code",
		branch: null,
		computerId: COMPUTER_ID,
		issueSnapshots: [],
		launchKey: crypto.randomUUID(),
		sessionTokenId: credential.tokenId,
		taskId: task.id,
		workspaceKind: "standalone",
	});
}

it("pushes a launch command per created run to the registered socket", async () => {
	const rig = buildChannelRig();
	const run = await seedCreatedRun(rig);
	const { sent, socket } = fakeSocket();
	rig.channel.register(COMPUTER_ID, socket);

	await rig.channel.notifyComputer(COMPUTER_ID);

	expect(sent).toHaveLength(1);
	const first = sent[0];
	expect(first).toMatchObject({ kind: "launch", runId: run.id });
	if (first?.kind !== "launch") {
		throw new Error("expected a launch command");
	}
	expect(first.sessionCredential.startsWith("bt_")).toBe(true);
});

it("redelivers on repeat notify until the run is acked, then never again", async () => {
	const rig = buildChannelRig();
	const run = await seedCreatedRun(rig);
	const { sent, socket } = fakeSocket();
	rig.channel.register(COMPUTER_ID, socket);

	await rig.channel.notifyComputer(COMPUTER_ID);
	await rig.channel.notifyComputer(COMPUTER_ID);
	expect(sent).toHaveLength(DELIVERED_TWICE);

	await rig.run.updateStatus(run.id, { status: "launching" });
	await rig.channel.notifyComputer(COMPUTER_ID);
	expect(sent).toHaveLength(DELIVERED_TWICE);
});

it("pushes clone commands ahead of launches, decrypting the project token (Q1)", async () => {
	const rig = buildChannelRig();
	const run = await seedCreatedRun(rig);
	const project = await rig.project.insert({
		computerId: COMPUTER_ID,
		encryptedToken: rig.secretBox.encrypt("ghp_project_token"),
		name: "Better Agent",
		repoCloneUrl: "https://github.com/acme/better-agent.git",
		repoFullName: "acme/better-agent",
		tokenLast4: "oken",
		userId: USER_ID,
	});
	const { sent, socket } = fakeSocket();
	rig.channel.register(COMPUTER_ID, socket);

	await rig.channel.notifyComputer(COMPUTER_ID);

	expect(sent).toHaveLength(DELIVERED_TWICE);
	expect(sent[0]).toEqual({
		kind: "clone_project",
		projectId: project.id,
		repoCloneUrl: "https://github.com/acme/better-agent.git",
		token: "ghp_project_token",
	});
	expect(sent[1]).toMatchObject({ kind: "launch", runId: run.id });

	// The ack (created→cloning) removes the clone from the derivation.
	await rig.project.updateStatus(project.id, { status: "cloning" });
	sent.length = 0;
	await rig.channel.notifyComputer(COMPUTER_ID);
	expect(sent).toHaveLength(1);
	expect(sent[0]?.kind).toBe("launch");
});

it("is a no-op for a computer with no registered socket", async () => {
	const rig = buildChannelRig();
	await seedCreatedRun(rig);
	await expect(
		rig.channel.notifyComputer(COMPUTER_ID)
	).resolves.toBeUndefined();
});

it("unregister removes the socket, but a stale unregister keeps a newer one", async () => {
	const rig = buildChannelRig();
	await seedCreatedRun(rig);
	const first = fakeSocket();
	const second = fakeSocket();
	rig.channel.register(COMPUTER_ID, first.socket);
	rig.channel.register(COMPUTER_ID, second.socket);

	// The stale (replaced) connection closing must not tear down the live one.
	rig.channel.unregister(COMPUTER_ID, first.socket);
	await rig.channel.notifyComputer(COMPUTER_ID);
	expect(first.sent).toHaveLength(0);
	expect(second.sent).toHaveLength(1);

	rig.channel.unregister(COMPUTER_ID, second.socket);
	await rig.channel.notifyComputer(COMPUTER_ID);
	expect(second.sent).toHaveLength(1);
});
