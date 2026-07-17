import { describe, expect, it, vi } from "vitest";
import { runComputerClient } from "./computer-client";
import {
	clientArgs,
	fakeDeps,
	fakeTransport,
	SERVER_URL,
	storedIdentity,
	waitTimes,
} from "./computer-client-test-helpers";

// Pairing UX specs, split out of computer-client.test.ts (same reason the
// S25-T1 launch specs live in computer-client-launch.test.ts): --pair is
// idempotent per machine+server — rerunning the saved one-liner after the
// one-time code was consumed must start, not fail — and a genuinely bad code
// exits with an actionable message instead of the server's opaque
// UNAUTHORIZED. Shared fixtures in computer-client-test-helpers.ts.

const ACTIONABLE_PAIR_FAILURE =
	/Pairing failed: the code is invalid, expired, or already used \(each code pairs exactly one computer\)/;

function unauthorizedError(): Error {
	return Object.assign(new Error("Invalid or expired pairing code"), {
		code: "UNAUTHORIZED",
	});
}

describe("runComputerClient - idempotent --pair", () => {
	it("skips pairing when this machine already holds an identity for the same server", async () => {
		const transport = fakeTransport();
		const log = vi.fn();
		const save = vi.fn(() => Promise.resolve());
		const deps = fakeDeps({
			identityFile: {
				load: () => Promise.resolve(storedIdentity),
				loadOrFail: () => Promise.reject(new Error("must not loadOrFail")),
				save,
			},
			log,
			transport,
			wait: waitTimes(1),
		});

		const result = await runComputerClient(clientArgs("pc_reused"), deps);

		expect(result).toEqual({ computerId: "computer-9" });
		expect(transport.pair).not.toHaveBeenCalled();
		expect(save).not.toHaveBeenCalled();
		expect(transport.register).toHaveBeenCalledTimes(1);
		expect(transport.heartbeat).toHaveBeenCalledTimes(1);
		expect(log).toHaveBeenCalledWith(
			expect.stringContaining("already paired (computer computer-9)")
		);
		expect(log).toHaveBeenCalledWith(
			expect.stringContaining("delete ~/.better-agent/identity.json")
		);
	});
});

describe("runComputerClient - idempotent --pair, different server", () => {
	it("pairs fresh for a different server and notes the replaced identity", async () => {
		const transport = fakeTransport();
		const log = vi.fn();
		const save = vi.fn(() => Promise.resolve());
		const deps = fakeDeps({
			identityFile: {
				load: () =>
					Promise.resolve({
						computerId: "computer-old",
						privateKeyPem: "old-private-pem",
						serverUrl: "https://other.example.com",
					}),
				loadOrFail: () => Promise.reject(new Error("must not loadOrFail")),
				save,
			},
			log,
			transport,
		});

		const result = await runComputerClient(clientArgs("pc_code123"), deps);

		expect(result).toEqual({ computerId: "computer-1" });
		expect(transport.pair).toHaveBeenCalledTimes(1);
		expect(save).toHaveBeenCalledExactlyOnceWith({
			computerId: "computer-1",
			privateKeyPem: "generated-private-pem",
			serverUrl: SERVER_URL,
		});
		expect(log).toHaveBeenCalledWith(expect.stringContaining("computer-old"));
	});
});

describe("runComputerClient - pairing success output", () => {
	it("tells the user the rerun command needs no --pair after pairing", async () => {
		const transport = fakeTransport();
		const log = vi.fn();
		const deps = fakeDeps({ log, transport });

		await runComputerClient(clientArgs("pc_code123"), deps);

		expect(log).toHaveBeenCalledWith(
			expect.stringContaining(
				`From now on just run: agent-cli --client --server ${SERVER_URL}`
			)
		);
	});
});

describe("runComputerClient - pairing failures", () => {
	it("rewrites an UNAUTHORIZED pair failure into an actionable message", async () => {
		const transport = fakeTransport();
		transport.pair.mockRejectedValueOnce(unauthorizedError());
		const deps = fakeDeps({ transport });

		const failure = runComputerClient(clientArgs("pc_used"), deps);
		await expect(failure).rejects.toThrow(ACTIONABLE_PAIR_FAILURE);
		expect(transport.register).not.toHaveBeenCalled();
	});

	it("keeps the web regenerate path and the server error in the message", async () => {
		const transport = fakeTransport();
		transport.pair.mockRejectedValueOnce(unauthorizedError());
		const deps = fakeDeps({ transport });

		const failure = await runComputerClient(clientArgs("pc_used"), deps).then(
			() => null,
			(error: Error) => error
		);
		expect(failure?.message).toContain("Computers → Pair new computer");
		expect(failure?.message).toContain("Invalid or expired pairing code");
	});

	it("passes non-UNAUTHORIZED pair failures through untouched", async () => {
		const transport = fakeTransport();
		const networkError = new Error("fetch failed");
		transport.pair.mockRejectedValueOnce(networkError);
		const deps = fakeDeps({ transport });

		await expect(
			runComputerClient(clientArgs("pc_code123"), deps)
		).rejects.toBe(networkError);
		expect(transport.register).not.toHaveBeenCalled();
	});
});
