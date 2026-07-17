import { describe, expect, it, vi } from "vitest";
import { createHeartbeatWait, runComputerClient } from "./computer-client";
import {
	clientArgs,
	fakeDeps,
	fakeTransport,
	SERVER_URL,
	waitTimes,
} from "./computer-client-test-helpers";

// Lifecycle of the client mode (never starts an Agent): with --pair it
// generates a keypair, pairs, persists the identity, then falls into the
// same register-once + heartbeat loop the identity-file path uses. Transient
// heartbeat errors are reported but never end the loop; only the injected
// wait (abort-driven in production) does. The S25-T1 launch-delivery specs
// live in computer-client-launch.test.ts, the idempotent-pair and
// pair-failure UX specs in computer-client-pair.test.ts; shared fixtures in
// computer-client-test-helpers.ts.

const PAIR_HINT = /--pair/;

describe("runComputerClient - pairing", () => {
	it("pairs with a fresh keypair, persists the identity, then registers", async () => {
		const transport = fakeTransport();
		const save = vi.fn(() => Promise.resolve());
		const deps = fakeDeps({
			identityFile: {
				load: () => Promise.resolve(null),
				loadOrFail: () => Promise.reject(new Error("must not load")),
				save,
			},
			transport,
		});

		const result = await runComputerClient(clientArgs("pc_code123"), deps);

		expect(result).toEqual({ computerId: "computer-1" });
		expect(transport.pair).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({
				code: "pc_code123",
				name: "Studio Mac",
				publicKeyPem: "generated-public-pem",
			})
		);
		expect(save).toHaveBeenCalledExactlyOnceWith({
			computerId: "computer-1",
			privateKeyPem: "generated-private-pem",
			serverUrl: SERVER_URL,
		});
		expect(transport.setIdentity).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ computerId: "computer-1" })
		);
		expect(transport.register).toHaveBeenCalledTimes(1);
	});
});

describe("runComputerClient - pairing payload", () => {
	it("sends the detected inventory and platform facts when pairing", async () => {
		const transport = fakeTransport();
		const deps = fakeDeps({ transport });

		await runComputerClient(clientArgs("pc_code123"), deps);

		expect(transport.pair).toHaveBeenCalledWith(
			expect.objectContaining({
				arch: "arm64",
				clientVersion: "0.4.0",
				platform: "darwin",
				runtimeInventory: [
					{
						agentKind: "claude-code",
						skillCapability: "discoverable",
						skills: [],
					},
				],
				toolInventory: [
					{ installed: true, name: "git" },
					{ installed: false, name: "gh" },
				],
			})
		);
	});
});

describe("runComputerClient - stored identity", () => {
	it("loads the identity file and never pairs", async () => {
		const transport = fakeTransport();
		const deps = fakeDeps({ transport, wait: waitTimes(1) });

		const result = await runComputerClient(clientArgs(), deps);

		expect(result).toEqual({ computerId: "computer-9" });
		expect(transport.pair).not.toHaveBeenCalled();
		expect(transport.setIdentity).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({
				computerId: "computer-9",
				privateKeyPem: "stored-private-pem",
			})
		);
		expect(transport.register).toHaveBeenCalledTimes(1);
	});

	it("fails without registering when no identity exists and no --pair given", async () => {
		const transport = fakeTransport();
		const deps = fakeDeps({
			identityFile: {
				load: () => Promise.resolve(null),
				loadOrFail: () =>
					Promise.reject(new Error("No computer identity — run --pair first")),
				save: () => Promise.resolve(),
			},
			transport,
		});

		await expect(runComputerClient(clientArgs(), deps)).rejects.toThrow(
			PAIR_HINT
		);
		expect(transport.register).not.toHaveBeenCalled();
		expect(transport.heartbeat).not.toHaveBeenCalled();
	});
});

describe("runComputerClient - heartbeat loop", () => {
	it("registers once and heartbeats once per completed wait", async () => {
		const transport = fakeTransport();
		await runComputerClient(
			clientArgs(),
			fakeDeps({ transport, wait: waitTimes(3) })
		);
		expect(transport.register).toHaveBeenCalledTimes(1);
		expect(transport.heartbeat).toHaveBeenCalledTimes(3);
	});

	it("does not heartbeat when stopped during the first wait", async () => {
		const transport = fakeTransport();
		await runComputerClient(
			clientArgs(),
			fakeDeps({ transport, wait: waitTimes(0) })
		);
		expect(transport.register).toHaveBeenCalledTimes(1);
		expect(transport.heartbeat).not.toHaveBeenCalled();
	});

	it("stays alive after a transient heartbeat error", async () => {
		const transport = fakeTransport();
		transport.heartbeat
			.mockRejectedValueOnce(new Error("network unavailable"))
			.mockResolvedValueOnce({ pendingCommands: [] });
		const onHeartbeatError = vi.fn();

		await runComputerClient(
			clientArgs(),
			fakeDeps({ onHeartbeatError, transport, wait: waitTimes(2) })
		);

		expect(transport.heartbeat).toHaveBeenCalledTimes(2);
		expect(onHeartbeatError).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ message: "network unavailable" })
		);
	});
});

describe("createHeartbeatWait", () => {
	it("resolves true after the interval and false once aborted", async () => {
		vi.useFakeTimers();
		try {
			const controller = new AbortController();
			const wait = createHeartbeatWait(controller.signal, 10_000);

			const first = wait();
			await vi.advanceTimersByTimeAsync(10_000);
			await expect(first).resolves.toBe(true);

			const second = wait();
			controller.abort();
			await expect(second).resolves.toBe(false);
			await expect(wait()).resolves.toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});
});
