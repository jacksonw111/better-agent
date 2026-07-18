import { vi } from "vitest";
import type { ClientCliArgs } from "./args";
import type { ComputerClientDeps } from "./computer-client";
import type { ComputerIdentity } from "./computer-identity";
import type { ComputerTransport } from "./computer-transport";

// Shared fixtures for computer-client.test.ts and
// computer-client-launch.test.ts — split out (mirrors
// ws-duplex-test-helpers.ts) so the S25-T1 launch-delivery specs could move
// to their own file without duplicating the client-mode fakes.

export const SERVER_URL = "https://bridge.example.com";

export const storedIdentity: ComputerIdentity = {
	computerId: "computer-9",
	privateKeyPem: "stored-private-pem",
	serverUrl: SERVER_URL,
};

export function clientArgs(pairCode?: string): ClientCliArgs {
	return {
		mode: "client",
		name: "Studio Mac",
		pairCode,
		serverUrl: SERVER_URL,
	};
}

export function fakeTransport() {
	return {
		ackClone: vi.fn<ComputerTransport["ackClone"]>(() =>
			Promise.resolve({ ok: true })
		),
		ackLaunch: vi.fn<ComputerTransport["ackLaunch"]>(() =>
			Promise.resolve({ ok: true })
		),
		heartbeat: vi.fn<ComputerTransport["heartbeat"]>(() =>
			Promise.resolve({ pendingCommands: [] })
		),
		pair: vi.fn<ComputerTransport["pair"]>(() =>
			Promise.resolve({ computerId: "computer-1" })
		),
		register: vi.fn<ComputerTransport["register"]>(() => Promise.resolve()),
		reportCloneResult: vi.fn<ComputerTransport["reportCloneResult"]>(() =>
			Promise.resolve({ ok: true })
		),
		setIdentity: vi.fn<ComputerTransport["setIdentity"]>(),
		submitProjectQueryResult: vi.fn<
			ComputerTransport["submitProjectQueryResult"]
		>(() => Promise.resolve({ ok: true })),
		updateRunStatus: vi.fn<ComputerTransport["updateRunStatus"]>(() =>
			Promise.resolve({ ok: true })
		),
	} satisfies ComputerTransport;
}

/** A wait that allows `beats` heartbeat intervals before ending the loop. */
export function waitTimes(beats: number): () => Promise<boolean> {
	let remaining = beats;
	return () => {
		remaining -= 1;
		return Promise.resolve(remaining >= 0);
	};
}

export function fakeDeps(
	overrides: Partial<ComputerClientDeps> = {}
): ComputerClientDeps {
	return {
		detectInventory: () =>
			Promise.resolve({
				runtimeInventory: [
					{
						agentKind: "claude-code" as const,
						skillCapability: "discoverable" as const,
						skills: [],
					},
				],
				toolInventory: [
					{ installed: true, name: "git" as const },
					{ installed: false, name: "gh" as const },
				],
			}),
		generateKeyPair: () => ({
			privateKeyPem: "generated-private-pem",
			publicKeyPem: "generated-public-pem",
		}),
		// Fresh machine by default: no identity file yet (`load` → null), while
		// the no-pair path (`loadOrFail`) still finds the stored identity.
		identityFile: {
			load: () => Promise.resolve(null),
			loadOrFail: () => Promise.resolve(storedIdentity),
			save: vi.fn(() => Promise.resolve()),
		},
		log: vi.fn(),
		onHeartbeatError: vi.fn(),
		platformInfo: { arch: "arm64", clientVersion: "0.4.0", platform: "darwin" },
		transport: fakeTransport(),
		wait: waitTimes(0),
		...overrides,
	};
}
