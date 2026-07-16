import { expect, it } from "vitest";
import {
	COMPUTER_AUTH_WINDOW_MS,
	createReplayGuard,
	generateComputerKeyPair,
	signComputerRequest,
	verifyComputerRequest,
} from "./computer-signature";

// S1-T2 (design D1): computer requests are authenticated with an Ed25519
// signature over `${computerId}.${timestampMs}`, plus a freshness window and
// strictly increasing per-computer timestamps (in-memory replay guard).

const COMPUTER_ID = "11111111-2222-4333-8444-555555555555";
const TS = 1_752_600_000_000;

it("verifies a signature produced for the same computer and timestamp", () => {
	const { privateKeyPem, publicKeyPem } = generateComputerKeyPair();
	const signature = signComputerRequest(privateKeyPem, COMPUTER_ID, TS);
	expect(verifyComputerRequest(publicKeyPem, COMPUTER_ID, TS, signature)).toBe(
		true
	);
});

it("rejects when the computer id or timestamp differs from what was signed", () => {
	const { privateKeyPem, publicKeyPem } = generateComputerKeyPair();
	const signature = signComputerRequest(privateKeyPem, COMPUTER_ID, TS);
	expect(verifyComputerRequest(publicKeyPem, "other-id", TS, signature)).toBe(
		false
	);
	expect(
		verifyComputerRequest(publicKeyPem, COMPUTER_ID, TS + 1, signature)
	).toBe(false);
});

it("rejects a signature from a different keypair", () => {
	const alice = generateComputerKeyPair();
	const mallory = generateComputerKeyPair();
	const signature = signComputerRequest(mallory.privateKeyPem, COMPUTER_ID, TS);
	expect(
		verifyComputerRequest(alice.publicKeyPem, COMPUTER_ID, TS, signature)
	).toBe(false);
});

it("returns false instead of throwing for malformed keys and signatures", () => {
	const { privateKeyPem, publicKeyPem } = generateComputerKeyPair();
	const signature = signComputerRequest(privateKeyPem, COMPUTER_ID, TS);
	expect(verifyComputerRequest("not-a-pem", COMPUTER_ID, TS, signature)).toBe(
		false
	);
	expect(
		verifyComputerRequest(publicKeyPem, COMPUTER_ID, TS, "@@not-base64@@")
	).toBe(false);
});

it("replay guard accepts fresh, strictly increasing timestamps", () => {
	const guard = createReplayGuard();
	expect(guard.check(COMPUTER_ID, TS, TS)).toBe("ok");
	expect(guard.check(COMPUTER_ID, TS + 1, TS + 1)).toBe("ok");
});

it("replay guard flags equal or older timestamps as replayed", () => {
	const guard = createReplayGuard();
	expect(guard.check(COMPUTER_ID, TS, TS)).toBe("ok");
	expect(guard.check(COMPUTER_ID, TS, TS)).toBe("replayed");
	expect(guard.check(COMPUTER_ID, TS - 1, TS)).toBe("replayed");
});

it("replay guard flags timestamps outside the window as stale, past and future", () => {
	const guard = createReplayGuard();
	expect(guard.check(COMPUTER_ID, TS - COMPUTER_AUTH_WINDOW_MS - 1, TS)).toBe(
		"stale"
	);
	expect(guard.check(COMPUTER_ID, TS + COMPUTER_AUTH_WINDOW_MS + 1, TS)).toBe(
		"stale"
	);
	// Exactly at the window edge is still acceptable.
	expect(guard.check(COMPUTER_ID, TS - COMPUTER_AUTH_WINDOW_MS, TS)).toBe("ok");
});

it("a stale timestamp does not advance the monotonic floor", () => {
	const guard = createReplayGuard();
	expect(guard.check(COMPUTER_ID, TS + COMPUTER_AUTH_WINDOW_MS + 1, TS)).toBe(
		"stale"
	);
	expect(guard.check(COMPUTER_ID, TS, TS)).toBe("ok");
});

it("replay guard tracks timestamps per computer independently", () => {
	const guard = createReplayGuard();
	expect(guard.check("computer-a", TS, TS)).toBe("ok");
	expect(guard.check("computer-b", TS, TS)).toBe("ok");
});
