import {
	COMPUTER_OFFLINE_AFTER_MS,
	COMPUTER_PAIRING_CODE_TTL_MS,
} from "@better-agent/agent/computer-ports";
import {
	COMPUTER_AUTH_WINDOW_MS,
	generateComputerKeyPair,
} from "@better-agent/agent/crypto/computer-signature";
import { afterEach, expect, it, vi } from "vitest";
import {
	ALICE,
	BOB,
	buildComputerRig,
	signedAuth,
} from "./computers-test-helpers";

// S1-T2: computers router — pairing (one-time code), signed computer-plane
// register/heartbeat, and the owner-scoped createPairingCode/list/delete.

const REGISTRATION = {
	name: "John's MacBook",
	platform: "darwin",
	arch: "arm64",
	clientVersion: "0.3.0",
	runtimeInventory: [
		{
			agentKind: "claude-code" as const,
			skillCapability: "discoverable" as const,
			skills: [{ name: "tdd", description: "Red-green-refactor" }],
		},
	],
	toolInventory: [
		{ name: "git" as const, installed: true },
		{ name: "gh" as const, installed: false },
	],
};

type Rig = ReturnType<typeof buildComputerRig>;

async function pairComputer(rig: Rig, user: typeof ALICE) {
	const { code } = await rig.userClientFor(user).computers.createPairingCode();
	const keys = generateComputerKeyPair();
	const { computerId } = await rig.publicClient.computers.pair({
		...REGISTRATION,
		code,
		publicKeyPem: keys.publicKeyPem,
	});
	return { computerId, ...keys };
}

afterEach(() => {
	vi.useRealTimers();
});

it("pairs a computer with a fresh code and stores it under the code's owner", async () => {
	const rig = buildComputerRig();
	const { computerId } = await pairComputer(rig, ALICE);
	const stored = rig.rows.get(computerId);
	expect(stored?.userId).toBe(ALICE.id);
	expect(stored?.name).toBe("John's MacBook");
	expect(stored?.runtimeInventory).toEqual(REGISTRATION.runtimeInventory);
});

it("rejects an expired pairing code", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-07-15T12:00:00.000Z"));
	const rig = buildComputerRig();
	const { code } = await rig.userClientFor(ALICE).computers.createPairingCode();
	vi.advanceTimersByTime(COMPUTER_PAIRING_CODE_TTL_MS + 1);
	await expect(
		rig.publicClient.computers.pair({
			...REGISTRATION,
			code,
			publicKeyPem: generateComputerKeyPair().publicKeyPem,
		})
	).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});

it("rejects a pairing code that was already used", async () => {
	const rig = buildComputerRig();
	const { code } = await rig.userClientFor(ALICE).computers.createPairingCode();
	const publicKeyPem = generateComputerKeyPair().publicKeyPem;
	await rig.publicClient.computers.pair({
		...REGISTRATION,
		code,
		publicKeyPem,
	});
	await expect(
		rig.publicClient.computers.pair({ ...REGISTRATION, code, publicKeyPem })
	).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});

it("register with a valid signature refreshes attributes and inventory", async () => {
	const rig = buildComputerRig();
	const paired = await pairComputer(rig, ALICE);
	const client = rig.computerClientFor(
		signedAuth(paired.computerId, paired.privateKeyPem)
	);
	await expect(
		client.computers.register({ ...REGISTRATION, clientVersion: "0.3.1" })
	).resolves.toEqual({ ok: true });
	expect(rig.rows.get(paired.computerId)?.clientVersion).toBe("0.3.1");
});

it("heartbeat with a valid signature touches lastSeenAt and returns no pending commands", async () => {
	const rig = buildComputerRig();
	const paired = await pairComputer(rig, ALICE);
	const STALE_HEARTBEAT_AGE_MS = 60_000;
	const before = new Date(Date.now() - STALE_HEARTBEAT_AGE_MS);
	await rig.computer.touch(paired.computerId, before);
	const client = rig.computerClientFor(
		signedAuth(paired.computerId, paired.privateKeyPem)
	);
	await expect(client.computers.heartbeat()).resolves.toEqual({
		ok: true,
		pendingCommands: [],
	});
	const lastSeenAt = rig.rows.get(paired.computerId)?.lastSeenAt;
	expect(lastSeenAt?.getTime()).toBeGreaterThan(before.getTime());
});

it("rejects a tampered signature and a signature from another keypair", async () => {
	const rig = buildComputerRig();
	const paired = await pairComputer(rig, ALICE);
	const good = signedAuth(paired.computerId, paired.privateKeyPem);
	const tampered = rig.computerClientFor({
		...good,
		timestampMs: good.timestampMs + 1,
	});
	await expect(tampered.computers.heartbeat()).rejects.toMatchObject({
		code: "UNAUTHORIZED",
	});
	const wrongKey = rig.computerClientFor(
		signedAuth(paired.computerId, generateComputerKeyPair().privateKeyPem)
	);
	await expect(wrongKey.computers.heartbeat()).rejects.toMatchObject({
		code: "UNAUTHORIZED",
	});
});

it("rejects an unknown computer id even with a well-formed signature", async () => {
	const rig = buildComputerRig();
	const keys = generateComputerKeyPair();
	const client = rig.computerClientFor(
		signedAuth(crypto.randomUUID(), keys.privateKeyPem)
	);
	await expect(client.computers.heartbeat()).rejects.toMatchObject({
		code: "UNAUTHORIZED",
	});
});

it("rejects a correctly signed request whose timestamp is outside the window", async () => {
	const rig = buildComputerRig();
	const paired = await pairComputer(rig, ALICE);
	const stale = Date.now() - COMPUTER_AUTH_WINDOW_MS - 1;
	const client = rig.computerClientFor(
		signedAuth(paired.computerId, paired.privateKeyPem, stale)
	);
	await expect(client.computers.heartbeat()).rejects.toMatchObject({
		code: "UNAUTHORIZED",
	});
});

it("rejects a replayed timestamp: they must strictly increase per computer", async () => {
	const rig = buildComputerRig();
	const paired = await pairComputer(rig, ALICE);
	const auth = signedAuth(paired.computerId, paired.privateKeyPem);
	await rig.computerClientFor(auth).computers.heartbeat();
	await expect(
		rig.computerClientFor(auth).computers.heartbeat()
	).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	// An older (but in-window) timestamp is also refused.
	const older = signedAuth(
		paired.computerId,
		paired.privateKeyPem,
		auth.timestampMs - 1
	);
	await expect(
		rig.computerClientFor(older).computers.heartbeat()
	).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});

it("lists only the caller's computers with computed connected, no publicKeyPem", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-07-15T12:00:00.000Z"));
	const rig = buildComputerRig();
	await pairComputer(rig, ALICE);
	await pairComputer(rig, BOB);
	let computers = await rig.userClientFor(ALICE).computers.list();
	expect(computers).toHaveLength(1);
	expect(computers[0]).toMatchObject({
		name: "John's MacBook",
		connected: true,
	});
	expect(computers[0]).not.toHaveProperty("publicKeyPem");
	vi.advanceTimersByTime(COMPUTER_OFFLINE_AFTER_MS + 1);
	computers = await rig.userClientFor(ALICE).computers.list();
	expect(computers[0]?.connected).toBe(false);
});

it("delete is owner-scoped: another user's computer stays put", async () => {
	const rig = buildComputerRig();
	const { computerId } = await pairComputer(rig, ALICE);
	await expect(
		rig.userClientFor(BOB).computers.delete({ id: computerId })
	).rejects.toMatchObject({ code: "NOT_FOUND" });
	expect(rig.rows.has(computerId)).toBe(true);
	await expect(
		rig.userClientFor(ALICE).computers.delete({ id: computerId })
	).resolves.toEqual({ ok: true });
	expect(rig.rows.has(computerId)).toBe(false);
});
