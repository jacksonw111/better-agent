import type {
	ComputerRow,
	ComputerStore,
} from "@better-agent/agent/computer-ports";
import {
	type ComputerReplayGuard,
	verifyComputerRequest,
} from "@better-agent/agent/crypto/computer-signature";

// S2-T2: /computer-ws handshake auth (design D4). The same Ed25519 scheme as
// the x-ba-* header plane (computerProcedure in ../index.ts) — signature over
// `${computerId}.${timestampMs}`, freshness window, strictly increasing
// per-computer timestamps — but carried in query params, because a native
// WebSocket upgrade cannot set custom headers. Every failure is the same
// null (→ HTTP 401 before the upgrade), and the replay guard only runs AFTER
// signature verification so bogus requests never advance a computer's floor.

export interface ComputerWsHandshakeQuery {
	computerId?: string;
	sig?: string;
	ts?: string;
}

export interface ComputerWsHandshakeDeps {
	computerStore: Pick<ComputerStore, "getById">;
	replayGuard: ComputerReplayGuard;
}

export async function authenticateComputerWs(
	query: ComputerWsHandshakeQuery,
	deps: ComputerWsHandshakeDeps,
	nowMs: number = Date.now()
): Promise<ComputerRow | null> {
	const { computerId, sig, ts } = query;
	if (!(computerId && sig && ts)) {
		return null;
	}
	const timestampMs = Number(ts);
	if (!(Number.isSafeInteger(timestampMs) && timestampMs > 0)) {
		return null;
	}
	const computer = await deps.computerStore.getById(computerId);
	if (!computer) {
		return null;
	}
	const validSignature = verifyComputerRequest(
		computer.publicKeyPem,
		computerId,
		timestampMs,
		sig
	);
	if (!validSignature) {
		return null;
	}
	if (deps.replayGuard.check(computerId, timestampMs, nowMs) !== "ok") {
		return null;
	}
	return computer;
}
