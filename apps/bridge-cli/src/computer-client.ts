import {
	COMPUTER_HEARTBEAT_INTERVAL_MS,
	type ComputerPendingCommand,
} from "@better-agent/agent/computer-ports";
import type { ComputerKeyPair } from "@better-agent/agent/crypto/computer-signature";
import type { RunLaunchCommand } from "@better-agent/agent/task-ports";
import type { ClientCliArgs } from "./args";
import type { ComputerIdentity, IdentityFile } from "./computer-identity";
import type {
	ComputerAttributes,
	ComputerTransport,
} from "./computer-transport";
import type { ComputerInventory } from "./detect-inventory";

// The client-mode lifecycle (S1-T3): pair-or-load an identity, register once
// with the freshly detected inventory, then heartbeat forever. S25-T1 adds
// launch delivery on top: every heartbeat's `pendingCommands` — and, when
// wired, the /computer-ws push — feed the ONE launch handler
// (task-launch/launch-handler.ts), whose seen-set + server ack keep the two
// channels idempotent per runId. Launch processing never blocks the beat:
// each run's session lives in its own async task.

/** Resolves `true` after one heartbeat interval, `false` once aborted — the
 * loop's only exit. Errors never end it (see `runComputerClient`). */
export type HeartbeatWait = () => Promise<boolean>;

export function createHeartbeatWait(
	signal: AbortSignal,
	intervalMs: number = COMPUTER_HEARTBEAT_INTERVAL_MS
): HeartbeatWait {
	return () =>
		new Promise((resolve) => {
			if (signal.aborted) {
				resolve(false);
				return;
			}
			const onAbort = () => {
				clearTimeout(timer);
				resolve(false);
			};
			const timer = setTimeout(() => {
				signal.removeEventListener("abort", onAbort);
				resolve(true);
			}, intervalMs);
			signal.addEventListener("abort", onAbort, { once: true });
		});
}

/** The launch handler's surface the client loop drives (S25-T1) — see
 * task-launch/launch-handler.ts. `handle` never rejects; `settle` lets the
 * shutdown path wait for in-flight run sessions' final status reports. */
export interface LaunchCommandSink {
	handle(command: RunLaunchCommand): Promise<void>;
	settle(): Promise<void>;
}

export interface ComputerClientDeps {
	detectInventory(): Promise<ComputerInventory>;
	generateKeyPair(): ComputerKeyPair;
	identityFile: IdentityFile;
	/** S25-T1 launch processing. Optional: without one the client is a pure
	 * register+heartbeat daemon, exactly as before. */
	launchHandler?: LaunchCommandSink;
	log(message: string): void;
	onHeartbeatError(error: Error): void;
	platformInfo: { arch: string; clientVersion: string; platform: string };
	/** S25-T1: opens the /computer-ws push channel once the identity is
	 * known. Optional — heartbeat `pendingCommands` alone must (and does)
	 * deliver every launch, just with up to one beat of latency. */
	startControlChannel?: (identity: ComputerIdentity) => void;
	transport: ComputerTransport;
	wait: HeartbeatWait;
}

/** Fires the launch handler for each delivered command WITHOUT awaiting —
 * run sessions are long-lived; the heartbeat loop must keep beating. Non-
 * launch kinds (Q1's clone_project) are skipped for now: this client version
 * predates project support, and an unacked clone command simply stays queued
 * (same contract as the WS channel ignoring unknown frames). */
function dispatchLaunches(
	commands: ComputerPendingCommand[],
	handler: LaunchCommandSink | undefined
): void {
	if (!handler) {
		return;
	}
	for (const command of commands) {
		if (command.kind !== "launch") {
			continue;
		}
		// `handle` never rejects by contract; the catch is belt-and-braces so a
		// buggy handler can still never kill the heartbeat loop.
		handler.handle(command).catch(() => undefined);
	}
}

/** The server deliberately answers every bad code — unknown, expired, or
 * already consumed — with the same UNAUTHORIZED (no oracle), so the CLI is
 * the only place that can tell the user what to actually DO about it. */
function isUnauthorizedError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code: unknown }).code === "UNAUTHORIZED"
	);
}

/** Pair, turning the opaque UNAUTHORIZED into an actionable exit message:
 * each code pairs exactly one computer, and a fresh one comes from the web.
 * Anything else (network, 5xx) is a real transport failure — rethrown as-is. */
async function pairOrExplain(
	deps: ComputerClientDeps,
	input: Parameters<ComputerClientDeps["transport"]["pair"]>[0]
): Promise<{ computerId: string }> {
	try {
		return await deps.transport.pair(input);
	} catch (error) {
		if (!isUnauthorizedError(error)) {
			throw error;
		}
		const note = error instanceof Error ? error.message : String(error);
		throw new Error(
			"Pairing failed: the code is invalid, expired, or already used " +
				"(each code pairs exactly one computer). Generate a new code from " +
				`the web: Computers → Pair new computer. (server said: ${note})`
		);
	}
}

/** Fresh keypair → pair → persist. `replaced` is a pre-existing identity for
 * a DIFFERENT server that this pairing overwrites — called out in the output
 * so losing the old (unrecoverable) credential is never silent. */
async function pairNewIdentity(input: {
	args: ClientCliArgs;
	attributes: ComputerAttributes;
	deps: ComputerClientDeps;
	pairCode: string;
	replaced: ComputerIdentity | null;
}): Promise<ComputerIdentity> {
	const { args, attributes, deps, pairCode, replaced } = input;
	const keyPair = deps.generateKeyPair();
	const { computerId } = await pairOrExplain(deps, {
		...attributes,
		code: pairCode,
		publicKeyPem: keyPair.publicKeyPem,
	});
	const identity: ComputerIdentity = {
		computerId,
		privateKeyPem: keyPair.privateKeyPem,
		serverUrl: args.serverUrl,
	};
	await deps.identityFile.save(identity);
	deps.log(`Paired — computerId: ${computerId}`);
	if (replaced !== null) {
		deps.log(
			`Replaced the previous identity (computer ${replaced.computerId} for ${replaced.serverUrl}).`
		);
	}
	deps.log(
		`From now on just run: agent-cli --client --server ${args.serverUrl} (no --pair needed).`
	);
	return identity;
}

/** `--pair`: idempotent per machine+server. When an identity for the SAME
 * server already exists — the usual case is rerunning the saved pair command
 * after the one-time code was consumed — the flag is ignored and the client
 * starts with the existing identity instead of failing on a spent code.
 * Otherwise pair fresh (see `pairNewIdentity`). Without `--pair` the saved
 * identity is required — a missing file fails with the "--pair first" hint
 * from `loadOrFail`. */
async function resolveIdentity(
	args: ClientCliArgs,
	deps: ComputerClientDeps,
	attributes: ComputerAttributes
): Promise<ComputerIdentity> {
	if (args.pairCode === undefined) {
		return deps.identityFile.loadOrFail();
	}
	const existing = await deps.identityFile.load();
	if (existing !== null && existing.serverUrl === args.serverUrl) {
		deps.log(
			`This machine is already paired (computer ${existing.computerId}). ` +
				"Ignoring --pair and starting with the existing identity — to pair " +
				"as a new computer, delete ~/.better-agent/identity.json first."
		);
		return existing;
	}
	return pairNewIdentity({
		args,
		attributes,
		deps,
		pairCode: args.pairCode,
		replaced: existing,
	});
}

export async function runComputerClient(
	args: ClientCliArgs,
	deps: ComputerClientDeps
): Promise<{ computerId: string }> {
	const inventory = await deps.detectInventory();
	const attributes: ComputerAttributes = {
		...inventory,
		...deps.platformInfo,
		name: args.name,
	};
	const identity = await resolveIdentity(args, deps, attributes);
	deps.transport.setIdentity(identity);
	await deps.transport.register(attributes);
	deps.log(`Computer connected: ${identity.computerId}`);
	deps.startControlChannel?.(identity);
	while (await deps.wait()) {
		try {
			const { pendingCommands } = await deps.transport.heartbeat();
			dispatchLaunches(pendingCommands, deps.launchHandler);
		} catch (error) {
			// Transient by assumption: the server derives Offline from missed
			// heartbeats, so the right move is to keep trying, not to exit.
			deps.onHeartbeatError(
				error instanceof Error ? error : new Error(String(error))
			);
		}
	}
	// Shutdown (SIGINT/SIGTERM aborted the wait): the shared signal is already
	// winding every run session down — wait for their final status reports.
	await deps.launchHandler?.settle();
	return { computerId: identity.computerId };
}
