import type {
	ComputerPendingCommand,
	ComputerRuntimeInventoryItem,
	ManagedToolInventoryItem,
} from "@better-agent/agent/computer-ports";
import { signComputerRequest } from "@better-agent/agent/crypto/computer-signature";
import type { AppRouterClient } from "@better-agent/api/routers/index";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

// Computer-plane oRPC transport: `pair` is public (the one-time code IS the
// credential), while `register`/`heartbeat` carry the D1 signed x-ba-*
// headers. The RPCLink `headers` option is a function, so every request gets
// a FRESH timestamp + signature — required because the server's replay guard
// rejects any timestamp at or below the last accepted one per computer.

const TRAILING_SLASH = /\/$/;

/** Attributes sent on both pair and (re-)register. */
export interface ComputerAttributes {
	arch: string;
	clientVersion: string;
	name: string;
	platform: string;
	runtimeInventory: ComputerRuntimeInventoryItem[];
	toolInventory: ManagedToolInventoryItem[];
}

export interface ComputerPairInput extends ComputerAttributes {
	code: string;
	publicKeyPem: string;
}

/** What request signing needs — a subset of the identity file. */
export interface ComputerSigningIdentity {
	computerId: string;
	privateKeyPem: string;
}

/** A Run progress report (S25-T1) — mirrors `runs.updateStatus`'s input:
 * only provided fields change, `errorMessage` carries the REAL error. */
export interface RunStatusUpdateInput {
	errorMessage?: string;
	runId: string;
	status?:
		| "preparing_workspace"
		| "starting_runtime"
		| "running"
		| "waiting_for_user"
		| "completed"
		| "stopped"
		| "failed";
	workspacePath?: string;
}

export interface ComputerTransport {
	/** Acks one delivered Launch Command (S25-T1, design D4) — ok:false means
	 * the Run was already acked (a redelivery) and must be skipped. */
	ackLaunch(runId: string): Promise<{ ok: boolean }>;
	/** Heartbeat + the no-WS command delivery fallback: the server returns the
	 * Computer's still-unacked control-channel commands (launches and, Q1,
	 * clone_project) with every beat (D4). */
	heartbeat(): Promise<{ pendingCommands: ComputerPendingCommand[] }>;
	pair(input: ComputerPairInput): Promise<{ computerId: string }>;
	register(attributes: ComputerAttributes): Promise<void>;
	/** Arms the signed routes. Called once, after pairing or after loading the
	 * identity file — `pair` itself needs no identity. */
	setIdentity(identity: ComputerSigningIdentity): void;
	/** Reports a Run's launch progress / terminal state (S25-T1, §11.2). */
	updateRunStatus(update: RunStatusUpdateInput): Promise<{ ok: boolean }>;
}

/** The x-ba-* header triple the server's `computerProcedure` verifies. */
export function createComputerAuthHeaders(
	identity: ComputerSigningIdentity,
	timestampMs: number
): Record<string, string> {
	return {
		"x-ba-computer-id": identity.computerId,
		"x-ba-signature": signComputerRequest(
			identity.privateKeyPem,
			identity.computerId,
			timestampMs
		),
		"x-ba-timestamp": String(timestampMs),
	};
}

/** `Date.now()`, bumped to strictly increase across calls: two requests in
 * the same millisecond would otherwise trip the server's replay guard. */
export function createMonotonicTimestamp(
	now: () => number = Date.now
): () => number {
	let floor = 0;
	return () => {
		const timestamp = Math.max(now(), floor + 1);
		floor = timestamp;
		return timestamp;
	};
}

export function createComputerTransport(config: {
	now?: () => number;
	serverUrl: string;
}): ComputerTransport {
	const nextTimestamp = createMonotonicTimestamp(config.now);
	let identity: ComputerSigningIdentity | null = null;
	const link = new RPCLink({
		url: `${config.serverUrl.replace(TRAILING_SLASH, "")}/rpc`,
		// Evaluated per request; `pair` runs before an identity exists and is a
		// public route, so it simply sends no auth headers.
		headers: () =>
			identity === null
				? {}
				: createComputerAuthHeaders(identity, nextTimestamp()),
	});
	const client = createORPCClient(link) as AppRouterClient;
	return {
		ackLaunch: (runId) => client.runs.ackLaunch({ runId }),
		heartbeat: async () => {
			const { pendingCommands } = await client.computers.heartbeat();
			return { pendingCommands };
		},
		pair: (input) => client.computers.pair(input),
		register: async (attributes) => {
			await client.computers.register(attributes);
		},
		setIdentity: (next) => {
			identity = next;
		},
		updateRunStatus: (update) => client.runs.updateStatus(update),
	};
}
