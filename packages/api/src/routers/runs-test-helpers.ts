import type {
	ComputerRuntimeInventoryItem,
	ManagedToolInventoryItem,
} from "@better-agent/agent/computer-ports";
import { generateComputerKeyPair } from "@better-agent/agent/crypto/computer-signature";
import { createRunSessionCredential } from "@better-agent/agent/task/run-session-credential";
import {
	ALICE,
	type buildComputerRig,
	signedAuth,
} from "./computers-test-helpers";

// Shared fixtures for the runs/tasks router tests (S2-T2/S2-T3): a paired
// computer whose signed client mints strictly increasing timestamps, plus a
// directly-seeded created Run (bypassing tasks.create) for launch-delivery
// tests.

export interface RegistrationInput {
	arch: string;
	clientVersion: string;
	name: string;
	platform: string;
	runtimeInventory: ComputerRuntimeInventoryItem[];
	toolInventory: ManagedToolInventoryItem[];
}

export const REGISTRATION: RegistrationInput = {
	name: "John's MacBook",
	platform: "darwin",
	arch: "arm64",
	clientVersion: "0.3.0",
	runtimeInventory: [],
	toolInventory: [],
};

/** An inventory carrying only Claude Code — the minimum tasks.create accepts. */
export const CLAUDE_ONLY_INVENTORY: ComputerRuntimeInventoryItem[] = [
	{ agentKind: "claude-code", skillCapability: "discoverable", skills: [] },
];

export type Rig = ReturnType<typeof buildComputerRig>;

/** S4-T2: satisfies the rig's GitHub-connection gate for `user`. The fake
 * client ignores the token, so an encrypted placeholder is enough. */
export async function connectGithub(rig: Rig, user: typeof ALICE = ALICE) {
	await rig.githubConnection.upsert({
		credentialType: "pat",
		encryptedToken: rig.secretBox.encrypt("github_pat_fake"),
		tokenLast4: "fake",
		userId: user.id,
	});
}

export async function pairComputer(
	rig: Rig,
	user: typeof ALICE,
	overrides?: Partial<RegistrationInput>
) {
	const { code } = await rig.userClientFor(user).computers.createPairingCode();
	const keys = generateComputerKeyPair();
	const { computerId } = await rig.publicClient.computers.pair({
		...REGISTRATION,
		...overrides,
		code,
		publicKeyPem: keys.publicKeyPem,
	});
	// Per-computer strictly increasing timestamps for the replay guard —
	// sequential test calls can otherwise collide within one millisecond.
	let lastTs = Date.now();
	const client = () => {
		lastTs += 1;
		return rig.computerClientFor(
			signedAuth(computerId, keys.privateKeyPem, lastTs)
		);
	};
	return { client, computerId };
}

export interface SeedRepository {
	repositoryCloneUrl: string;
	repositoryDefaultBranch: string;
	repositoryFullName: string;
	repositoryUrl: string;
}

export async function seedRun(
	rig: Rig,
	computerId: string,
	overrides?: SeedRepository
) {
	const task = await rig.task.insert({
		userId: ALICE.id,
		computerId,
		agentKind: "claude-code",
		name: "Fix login flake",
		description: "Fix the flaky login test with /tdd",
		openingMessage: "Fix the flaky login test with /tdd",
		repositoryCloneUrl: overrides?.repositoryCloneUrl ?? null,
		repositoryDefaultBranch: overrides?.repositoryDefaultBranch ?? null,
		repositoryFullName: overrides?.repositoryFullName ?? null,
		repositoryUrl: overrides?.repositoryUrl ?? null,
	});
	const credential = await createRunSessionCredential({
		bridgeTokenStore: rig.bridgeToken,
	})({ agentKind: task.agentKind, taskId: task.id, userId: ALICE.id });
	const launchKey = crypto.randomUUID();
	const run = await rig.run.insert({
		agentKind: task.agentKind,
		branch: null,
		computerId,
		issueSnapshots: [],
		launchKey,
		sessionTokenId: credential.tokenId,
		taskId: task.id,
		workspaceKind: overrides ? "repository" : "standalone",
	});
	return { credential, run, task };
}
