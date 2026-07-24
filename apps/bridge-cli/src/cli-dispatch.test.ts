import { expect, it, vi } from "vitest";
import type { ClientCliArgs, SessionCliArgs, SyncCliArgs } from "./args";
import { dispatchCli } from "./cli-dispatch";

// The dispatch seam is what guarantees client mode can never reach Agent
// startup: each mode goes to exactly one handler, and the session handler
// receives the args unchanged so the legacy path stays byte-identical.

const clientArgs: ClientCliArgs = {
	mode: "client",
	name: "Studio Mac",
	pairCode: undefined,
	serverUrl: "https://server.example.com",
};

const sessionArgs: SessionCliArgs = {
	mode: "session",
	agentKind: "claude-code",
	cua: false,
	cuaImage: undefined,
	cuaVm: undefined,
	cuaVncUrl: undefined,
	debug: false,
	dir: "/tmp",
	label: undefined,
	opencodeTransport: "acp",
	resume: undefined,
	serverUrl: "https://server.example.com",
	token: "bt_test",
};

const syncArgs: SyncCliArgs = {
	force: false,
	mode: "sync",
	projectId: undefined,
	serverUrl: "https://server.example.com",
	token: "bt_test",
};

it("sends client mode only to the client handler", async () => {
	const startClient = vi.fn(() => Promise.resolve());
	const startSession = vi.fn(() => Promise.resolve());
	const startSync = vi.fn(() => Promise.resolve());
	await dispatchCli(clientArgs, { startClient, startSession, startSync });
	expect(startClient).toHaveBeenCalledExactlyOnceWith(clientArgs);
	expect(startSession).not.toHaveBeenCalled();
	expect(startSync).not.toHaveBeenCalled();
});

it("sends session mode only to the session handler", async () => {
	const startClient = vi.fn(() => Promise.resolve());
	const startSession = vi.fn(() => Promise.resolve());
	const startSync = vi.fn(() => Promise.resolve());
	await dispatchCli(sessionArgs, { startClient, startSession, startSync });
	expect(startSession).toHaveBeenCalledExactlyOnceWith(sessionArgs);
	expect(startClient).not.toHaveBeenCalled();
	expect(startSync).not.toHaveBeenCalled();
});

it("sends sync mode only to the sync handler", async () => {
	const startClient = vi.fn(() => Promise.resolve());
	const startSession = vi.fn(() => Promise.resolve());
	const startSync = vi.fn(() => Promise.resolve());
	await dispatchCli(syncArgs, { startClient, startSession, startSync });
	expect(startSync).toHaveBeenCalledExactlyOnceWith(syncArgs);
	expect(startClient).not.toHaveBeenCalled();
	expect(startSession).not.toHaveBeenCalled();
});
