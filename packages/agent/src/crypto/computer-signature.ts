import {
	createPrivateKey,
	createPublicKey,
	generateKeyPairSync,
	sign,
	verify,
} from "node:crypto";

// Computer request signing (S1-T2, design D1). A paired Computer proves its
// identity on every request by signing `${computerId}.${timestampMs}` with
// the Ed25519 private key it generated at pairing time; the server verifies
// against the stored public key. Freshness is enforced twice: the timestamp
// must be within COMPUTER_AUTH_WINDOW_MS of server time, and per computer it
// must be strictly increasing (in-memory replay guard — a single-instance
// deployment is the supported topology).

/** Signed requests are rejected when |now − timestamp| exceeds this (5 min). */
export const COMPUTER_AUTH_WINDOW_MS = 300_000;

export type ReplayCheckResult = "ok" | "stale" | "replayed";

export interface ComputerReplayGuard {
	check(
		computerId: string,
		timestampMs: number,
		nowMs: number
	): ReplayCheckResult;
}

export interface ComputerKeyPair {
	privateKeyPem: string;
	publicKeyPem: string;
}

function signedPayload(computerId: string, timestampMs: number): Buffer {
	return Buffer.from(`${computerId}.${timestampMs}`);
}

/** Fresh Ed25519 identity for a Computer: the client keeps the private key
 * (identity file), the server only ever sees the public key. */
export function generateComputerKeyPair(): ComputerKeyPair {
	const { privateKey, publicKey } = generateKeyPairSync("ed25519");
	return {
		privateKeyPem: privateKey
			.export({ format: "pem", type: "pkcs8" })
			.toString(),
		publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString(),
	};
}

/** Base64 Ed25519 signature over `${computerId}.${timestampMs}`. */
export function signComputerRequest(
	privateKeyPem: string,
	computerId: string,
	timestampMs: number
): string {
	const key = createPrivateKey(privateKeyPem);
	return sign(null, signedPayload(computerId, timestampMs), key).toString(
		"base64"
	);
}

/** Never throws: a malformed key or signature verifies as false, so callers
 * can treat every failure as the same UNAUTHORIZED. */
export function verifyComputerRequest(
	publicKeyPem: string,
	computerId: string,
	timestampMs: number,
	signature: string
): boolean {
	try {
		const key = createPublicKey(publicKeyPem);
		return verify(
			null,
			signedPayload(computerId, timestampMs),
			key,
			Buffer.from(signature, "base64")
		);
	} catch {
		return false;
	}
}

/** In-memory anti-replay: a timestamp outside the window is `stale` (and does
 * not advance the floor); one at or below the last accepted value for that
 * computer is `replayed`. Only an `ok` result records the timestamp. */
export function createReplayGuard(): ComputerReplayGuard {
	const lastAccepted = new Map<string, number>();
	return {
		check(computerId, timestampMs, nowMs) {
			if (Math.abs(nowMs - timestampMs) > COMPUTER_AUTH_WINDOW_MS) {
				return "stale";
			}
			const last = lastAccepted.get(computerId);
			if (last !== undefined && timestampMs <= last) {
				return "replayed";
			}
			lastAccepted.set(computerId, timestampMs);
			return "ok";
		},
	};
}
