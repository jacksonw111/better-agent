import { COMPUTER_HEARTBEAT_INTERVAL_MS } from "@better-agent/agent/computer-ports";
import type { ComputerKeyPair } from "@better-agent/agent/crypto/computer-signature";
import type { ClientCliArgs } from "./args";
import type { ComputerIdentity, IdentityFile } from "./computer-identity";
import type {
	ComputerAttributes,
	ComputerTransport,
} from "./computer-transport";
import type { ComputerInventory } from "./detect-inventory";

// The client-mode lifecycle (S1-T3): pair-or-load an identity, register once
// with the freshly detected inventory, then heartbeat forever. This module
// NEVER starts an Agent process — launching runtimes arrives with Slice 2.5's
// launch commands, and even then only through a dedicated path.

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

export interface ComputerClientDeps {
	detectInventory(): Promise<ComputerInventory>;
	generateKeyPair(): ComputerKeyPair;
	identityFile: IdentityFile;
	log(message: string): void;
	onHeartbeatError(error: Error): void;
	platformInfo: { arch: string; clientVersion: string; platform: string };
	transport: ComputerTransport;
	wait: HeartbeatWait;
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
	while (await deps.wait()) {
		try {
			await deps.transport.heartbeat();
		} catch (error) {
			// Transient by assumption: the server derives Offline from missed
			// heartbeats, so the right move is to keep trying, not to exit.
			deps.onHeartbeatError(
				error instanceof Error ? error : new Error(String(error))
			);
		}
	}
	return { computerId: identity.computerId };
}
