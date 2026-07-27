import { generateComputerKeyPair } from "@better-agent/agent/crypto/computer-signature";
import type {
	ProjectQueryCommand,
	WorkspaceQueryCommand,
} from "@better-agent/agent/project-ports";
import { describe, expect, it } from "vitest";
import type { WsEventMap, WsLike } from "../ws-duplex-socket";
import {
	type ControlChannelConfig,
	dispatchControlFrame,
	runControlChannel,
} from "./control-ws";

// DP-WS: the /computer-ws client — parses the real-time query frames
// (project_query / workspace_query), hands them to their executors, and ignores
// everything else, all on a best-effort reconnect loop.

const WS_CLOSE_NORMAL = 1000;

const keyPair = generateComputerKeyPair();
const identity = {
	computerId: "computer-7",
	privateKeyPem: keyPair.privateKeyPem,
};

function collect() {
	const projectQueries: ProjectQueryCommand[] = [];
	const workspaceQueries: WorkspaceQueryCommand[] = [];
	const config = {
		identity,
		onProjectQuery: (c: ProjectQueryCommand) => projectQueries.push(c),
		onWorkspaceQuery: (c: WorkspaceQueryCommand) => workspaceQueries.push(c),
		serverUrl: "http://localhost",
		signal: new AbortController().signal,
	} as ControlChannelConfig;
	return { config, projectQueries, workspaceQueries };
}

describe("dispatchControlFrame", () => {
	it("routes a project_query frame", () => {
		const { config, projectQueries } = collect();
		dispatchControlFrame(
			config,
			JSON.stringify({
				kind: "project_query",
				op: "fs_list",
				projectId: "p1",
				requestId: "r1",
			})
		);
		expect(projectQueries).toHaveLength(1);
		expect(projectQueries[0]).toMatchObject({ op: "fs_list", projectId: "p1" });
	});

	it("routes a workspace_query frame (including shell)", () => {
		const { config, workspaceQueries } = collect();
		dispatchControlFrame(
			config,
			JSON.stringify({
				cmd: "ls",
				kind: "workspace_query",
				op: "shell",
				requestId: "r2",
				workspaceRoot: "/w",
			})
		);
		expect(workspaceQueries).toHaveLength(1);
		expect(workspaceQueries[0]).toMatchObject({
			cmd: "ls",
			op: "shell",
			workspaceRoot: "/w",
		});
	});

	it("ignores unknown / malformed frames without throwing", () => {
		const { config, projectQueries, workspaceQueries } = collect();
		dispatchControlFrame(config, "not json");
		dispatchControlFrame(
			config,
			JSON.stringify({ kind: "launch", runId: "x" })
		);
		dispatchControlFrame(config, JSON.stringify(["not", "a", "record"]));
		expect(projectQueries).toHaveLength(0);
		expect(workspaceQueries).toHaveLength(0);
	});
});

class FakeControlSocket implements WsLike {
	closed = false;
	private readonly listeners: { [E in keyof WsEventMap]: WsEventMap[E][] } = {
		close: [],
		error: [],
		message: [],
		open: [],
	};
	on<E extends keyof WsEventMap>(event: E, listener: WsEventMap[E]): void {
		this.listeners[event].push(listener);
	}
	send(): void {
		// The control channel never sends — answers travel over oRPC.
	}
	close(): void {
		this.closed = true;
		for (const listener of this.listeners.close) {
			listener(WS_CLOSE_NORMAL, "");
		}
	}
	emitMessage(data: string): void {
		for (const listener of this.listeners.message) {
			listener(data);
		}
	}
}

describe("runControlChannel", () => {
	it("dispatches frames from a live socket and stops on abort", async () => {
		const controller = new AbortController();
		const workspaceQueries: WorkspaceQueryCommand[] = [];
		const socket = new FakeControlSocket();
		const loop = runControlChannel({
			identity,
			onWorkspaceQuery: (c) => workspaceQueries.push(c),
			serverUrl: "http://localhost",
			signal: controller.signal,
			sleep: () => Promise.resolve(),
			wsFactory: () => socket,
		});
		socket.emitMessage(
			JSON.stringify({
				kind: "workspace_query",
				op: "git_status",
				requestId: "r9",
				workspaceRoot: "",
			})
		);
		expect(workspaceQueries).toHaveLength(1);
		controller.abort();
		socket.close();
		await loop;
		expect(socket.closed).toBe(true);
	});
});
