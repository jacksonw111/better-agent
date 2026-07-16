import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ComputerIdentity, createIdentityFile } from "./computer-identity";

// The identity file IS the Computer's credential (it holds the Ed25519
// private key), so these tests pin the two security-relevant behaviors: the
// file is created 0600 inside a recursively created directory, and a missing
// file fails with an actionable "--pair first" message instead of a bare
// ENOENT.

const OWNER_ONLY_MODE = 0o600;
/** `stat().mode` is file-type bits + permission bits; modulo strips the type. */
const MODE_PERMISSION_MODULUS = 0o1000;
const PAIR_HINT = /--pair/;

const identity: ComputerIdentity = {
	computerId: "computer-1",
	privateKeyPem: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
	serverUrl: "https://bridge.example.com",
};

let root: string;
let filePath: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "computer-identity-"));
	// Two levels deep so `save` must create directories recursively.
	filePath = join(root, ".better-agent", "identity.json");
});

afterEach(async () => {
	await rm(root, { force: true, recursive: true });
});

describe("identity file - save", () => {
	it("round-trips the identity through a recursively created directory", async () => {
		const file = createIdentityFile(filePath);
		await file.save(identity);
		expect(await file.load()).toEqual(identity);
	});

	it("writes the file with owner-only 0600 permissions", async () => {
		await createIdentityFile(filePath).save(identity);
		const { mode } = await stat(filePath);
		expect(mode % MODE_PERMISSION_MODULUS).toBe(OWNER_ONLY_MODE);
	});

	it("stores plain JSON so a user can inspect their own identity", async () => {
		await createIdentityFile(filePath).save(identity);
		const raw = JSON.parse(await readFile(filePath, "utf8")) as unknown;
		expect(raw).toEqual(identity);
	});
});

describe("identity file - load", () => {
	it("returns null when the file does not exist", async () => {
		expect(await createIdentityFile(filePath).load()).toBeNull();
	});

	it("rejects a malformed identity file, naming the path", async () => {
		const file = createIdentityFile(filePath);
		await file.save(identity);
		await writeFile(filePath, "not json");
		await expect(file.load()).rejects.toThrow(filePath);
	});

	it("rejects an identity file missing required fields, naming the path", async () => {
		const file = createIdentityFile(filePath);
		await file.save(identity);
		await writeFile(filePath, JSON.stringify({ computerId: "computer-1" }));
		await expect(file.load()).rejects.toThrow(filePath);
	});
});

describe("identity file - loadOrFail", () => {
	it("returns the stored identity when present", async () => {
		const file = createIdentityFile(filePath);
		await file.save(identity);
		expect(await file.loadOrFail()).toEqual(identity);
	});

	it("fails with an actionable --pair hint when no identity exists", async () => {
		const file = createIdentityFile(filePath);
		await expect(file.loadOrFail()).rejects.toThrow(PAIR_HINT);
		await expect(file.loadOrFail()).rejects.toThrow(filePath);
	});
});
