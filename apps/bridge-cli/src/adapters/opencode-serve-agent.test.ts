import { afterEach, describe, expect, it, vi } from "vitest";
import {
	fetchServeAgents,
	fetchServeCommands,
	fetchServeHealth,
	logServeHealth,
	SERVE_AGENT_FALLBACK,
} from "./opencode-serve-agent";
import type { ServeHttp } from "./opencode-serve-http";
import { messageCalls, startServe } from "./opencode-serve-test-support";

vi.mock("./process-io", () => ({ spawnProcessIo: vi.fn() }));

afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

/** A minimal fake `ServeHttp` whose `getJson` is fully controlled by the
 * test — used to unit-test `fetchServeAgents`/`fetchServeHealth` directly,
 * rather than through the full `startServe()` adapter plumbing (whose fake
 * server fixtures are fixed at construction time, before a test gets a
 * chance to mutate them for the failure/fallback cases these functions need
 * to cover). */
function fakeHttp(getJson: ServeHttp["getJson"]): ServeHttp {
	return { baseUrl: "http://fake", getJson, headers: {}, postJson: vi.fn() };
}

describe("fetchServeAgents (R2-T3 item 7)", () => {
	it("returns the parsed selectable agents on success", async () => {
		const http = fakeHttp(() =>
			Promise.resolve([{ name: "build", mode: "primary" }])
		);
		expect(await fetchServeAgents(http)).toEqual(["build"]);
	});

	it("falls back to build/plan when the response has nothing selectable", async () => {
		const http = fakeHttp(() => Promise.resolve([]));
		expect(await fetchServeAgents(http)).toEqual(SERVE_AGENT_FALLBACK);
	});

	it("falls back to build/plan when the request itself fails (e.g. a 404 on an older server)", async () => {
		const http = fakeHttp(() => Promise.reject(new Error("HTTP 404")));
		expect(await fetchServeAgents(http)).toEqual(SERVE_AGENT_FALLBACK);
	});
});

describe("fetchServeHealth (R2-T3 item 6)", () => {
	it("returns the parsed health on success", async () => {
		const http = fakeHttp(() =>
			Promise.resolve({ healthy: true, version: "0.80.6" })
		);
		expect(await fetchServeHealth(http)).toEqual({
			healthy: true,
			version: "0.80.6",
		});
	});

	it("is undefined (treated as legacy) when the request fails", async () => {
		const http = fakeHttp(() => Promise.reject(new Error("HTTP 404")));
		expect(await fetchServeHealth(http)).toBeUndefined();
	});
});

describe("fetchServeCommands (R5-T1)", () => {
	it("returns the parsed command catalog on success", async () => {
		const http = fakeHttp(() =>
			Promise.resolve([{ name: "help", description: "Show help" }])
		);
		expect(await fetchServeCommands(http)).toEqual([
			{ name: "help", description: "Show help" },
		]);
	});

	it("returns [] (no fallback list) when the request fails", async () => {
		const http = fakeHttp(() => Promise.reject(new Error("HTTP 404")));
		expect(await fetchServeCommands(http)).toEqual([]);
	});
});

describe("logServeHealth", () => {
	it("logs the version when one is present", () => {
		const spy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
		logServeHealth({ healthy: true, version: "0.80.6" });
		expect(spy).toHaveBeenCalledWith(
			"[opencode-serve] server version 0.80.6\n"
		);
		spy.mockRestore();
	});

	it("logs a legacy note when there's no version (or no health at all)", () => {
		const spy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
		const legacyCallCount = 2;
		logServeHealth(undefined);
		logServeHealth({ healthy: true });
		expect(spy).toHaveBeenCalledTimes(legacyCallCount);
		for (const call of spy.mock.calls) {
			expect(call[0]).toContain("legacy server?");
		}
		spy.mockRestore();
	});
});

describe("opencodeServeAdapter - setPermissionMode (R2-T3 item 7)", () => {
	it("rides the chosen agent name on the next prompt's POST body", async () => {
		const { handle, server } = await startServe();

		handle.setPermissionMode?.("plan");
		handle.send("switch to plan mode");

		expect(messageCalls(server)[0]?.body).toEqual({
			parts: [{ type: "text", text: "switch to plan mode" }],
			agent: "plan",
		});
	});

	it("never touches the deprecated /mode route", async () => {
		const { handle, server } = await startServe();

		handle.setPermissionMode?.("build");

		const modeCall = server.calls.find((call) => call.url.endsWith("/mode"));
		expect(modeCall).toBeUndefined();
	});
});
