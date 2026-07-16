import { COMPUTER_HEARTBEAT_INTERVAL_MS } from "@better-agent/agent/computer-ports";
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
 * run sessions are long-lived; the heartbeat loop must keep beating. */
function dispatchLaunches(
	commands: RunLaunchCommand[],
	handler: LaunchCommandSink | undefined
): void {
	if (!handler) {
		return;
	}
	for (const command of commands) {
		// `handle` never rejects by contract; the catch is belt-and-braces so a
		// buggy handler can still never kill the heartbeat loop.
		handler.handle(command).catch(() => undefined);
	}
}

/** `--pair`: fresh keypair → pair (the server stores only the public key) →
 * persist the identity file. Otherwise the saved identity is required — a
 * missing file fails with the "--pair first" hint from `loadOrFail`. */
async function resolveIdentity(
	args: ClientCliArgs,
	deps: ComputerClientDeps,
	attributes: ComputerAttributes
): Promise<ComputerIdentity> {
	if (args.pairCode === undefined) {
		return deps.identityFile.loadOrFail();
	}
	const keyPair = deps.generateKeyPair();
	const { computerId } = await deps.transport.pair({
		...attributes,
		code: args.pairCode,
		publicKeyPem: keyPair.publicKeyPem,
	});
	const identity: ComputerIdentity = {
		computerId,
		privateKeyPem: keyPair.privateKeyPem,
		serverUrl: args.serverUrl,
	};
	await deps.identityFile.save(identity);
	deps.log(`Paired — computerId: ${computerId}`);
	return identity;
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
