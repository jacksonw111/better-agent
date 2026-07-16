import type { ComputerRow } from "@better-agent/agent/computer-ports";
import {
	COMPUTER_AUTH_WINDOW_MS,
	createReplayGuard,
	generateComputerKeyPair,
	signComputerRequest,
} from "@better-agent/agent/crypto/computer-signature";
import { expect, it } from "vitest";
import { authenticateComputerWs } from "./ws-handshake";

// S2-T2: /computer-ws handshake auth — same Ed25519-over-`${id}.${ts}` scheme
// as the x-ba-* header plane (computerProcedure), carried in query params
// because a native WebSocket upgrade cannot set custom headers.

const COMPUTER_ID = "11111111-1111-4111-8111-111111111111";

function buildDeps(publicKeyPem: string) {
	const row = { id: COMPUTER_ID, publicKeyPem } as ComputerRow;
	return {
		computerStore: {
			getById: (id: string) => Promise.resolve(id === COMPUTER_ID ? row : null),
		},
		replayGuard: createReplayGuard(),
	};
}

function signedQuery(privateKeyPem: string, ts: number) {
	return {
		computerId: COMPUTER_ID,
		sig: signComputerRequest(privateKeyPem, COMPUTER_ID, ts),
		ts: String(ts),
	};
}

it("accepts a well-signed fresh handshake and returns the computer", async () => {
	const keys = generateComputerKeyPair();
	const deps = buildDeps(keys.publicKeyPem);
	const computer = await authenticateComputerWs(
		signedQuery(keys.privateKeyPem, Date.now()),
		deps
	);
	expect(computer?.id).toBe(COMPUTER_ID);
});

it("rejects a missing or malformed query", async () => {
	const keys = generateComputerKeyPair();
	const deps = buildDeps(keys.publicKeyPem);
	expect(await authenticateComputerWs({}, deps)).toBeNull();
	expect(
		await authenticateComputerWs(
			{ ...signedQuery(keys.privateKeyPem, Date.now()), ts: "not-a-number" },
			deps
		)
	).toBeNull();
});

it("rejects a signature from another keypair and an unknown computer", async () => {
	const keys = generateComputerKeyPair();
	const wrong = generateComputerKeyPair();
	const deps = buildDeps(keys.publicKeyPem);
	expect(
		await authenticateComputerWs(
			signedQuery(wrong.privateKeyPem, Date.now()),
			deps
		)
	).toBeNull();
	expect(
		await authenticateComputerWs(
			{
				computerId: "unknown",
				sig: signComputerRequest(keys.privateKeyPem, "unknown", Date.now()),
				ts: String(Date.now()),
			},
			deps
		)
	).toBeNull();
});

it("rejects a stale timestamp and a replayed one", async () => {
	const keys = generateComputerKeyPair();
	const deps = buildDeps(keys.publicKeyPem);
	const stale = Date.now() - COMPUTER_AUTH_WINDOW_MS - 1;
	expect(
		await authenticateComputerWs(signedQuery(keys.privateKeyPem, stale), deps)
	).toBeNull();

	const ts = Date.now();
	const query = signedQuery(keys.privateKeyPem, ts);
	expect(await authenticateComputerWs(query, deps)).not.toBeNull();
	// Same signed handshake again: the replay guard refuses it.
	expect(await authenticateComputerWs(query, deps)).toBeNull();
});
