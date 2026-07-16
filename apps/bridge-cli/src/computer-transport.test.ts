import {
	generateComputerKeyPair,
	verifyComputerRequest,
} from "@better-agent/agent/crypto/computer-signature";
import { describe, expect, it } from "vitest";
import {
	createComputerAuthHeaders,
	createMonotonicTimestamp,
} from "./computer-transport";

// The wire format the server's computerProcedure verifies: x-ba-* headers
// carrying an Ed25519 signature over `${computerId}.${timestamp}`. The
// timestamp source must be strictly increasing per process because the
// server's replay guard rejects a repeated or non-advancing timestamp.

const TIMESTAMP_MS = 1_752_540_000_000;

describe("createComputerAuthHeaders", () => {
	it("produces headers the server-side verifier accepts", () => {
		const keyPair = generateComputerKeyPair();
		const headers = createComputerAuthHeaders(
			{ computerId: "computer-1", privateKeyPem: keyPair.privateKeyPem },
			TIMESTAMP_MS
		);
		expect(headers["x-ba-computer-id"]).toBe("computer-1");
		expect(headers["x-ba-timestamp"]).toBe(String(TIMESTAMP_MS));
		expect(
			verifyComputerRequest(
				keyPair.publicKeyPem,
				"computer-1",
				TIMESTAMP_MS,
				headers["x-ba-signature"] ?? ""
			)
		).toBe(true);
	});
});

describe("createMonotonicTimestamp", () => {
	it("never repeats a timestamp even when the clock stands still", () => {
		const next = createMonotonicTimestamp(() => TIMESTAMP_MS);
		expect(next()).toBe(TIMESTAMP_MS);
		expect(next()).toBe(TIMESTAMP_MS + 1);
		expect(next()).toBe(TIMESTAMP_MS + 2);
	});

	it("follows the clock once it moves past the floor", () => {
		let now = TIMESTAMP_MS;
		const next = createMonotonicTimestamp(() => now);
		next();
		now += 5000;
		expect(next()).toBe(now);
	});
});
