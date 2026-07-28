#!/usr/bin/env node
import { arch, platform } from "node:os";
import { generateComputerKeyPair } from "@better-agent/agent/crypto/computer-signature";
import {
	type ClientCliArgs,
	handleInfoFlags,
	parseArgs,
	type SessionCliArgs,
	type SyncCliArgs,
} from "./args";
import { dispatchCli } from "./cli-dispatch";
import { createHeartbeatWait, runComputerClient } from "./computer-client";
import { type ComputerIdentity, createIdentityFile } from "./computer-identity";
import {
	createComputerTransport,
	createMonotonicTimestamp,
} from "./computer-transport";
import { detectComputerInventory } from "./detect-inventory";
import { defaultHookEmitDeps, runHookEmit } from "./hooks/hook-emit";
import { createBundleFetcher } from "./profile-sync/bundle-client";
import { defaultSyncFs, defaultSyncRoots } from "./profile-sync/fs-ports";
import { syncProfile } from "./profile-sync/sync";
import {
	defaultPtyWsFactory,
	runPtyTransport,
} from "./pty-transport/pty-ws-transport";
import { runControlChannel } from "./task-launch/control-ws";
import { createCloneHandler } from "./task-launch/project-clone";
import { createProjectQueryHandler } from "./task-launch/project-query";
import { createWorkspaceQueryHandler } from "./task-launch/workspace-query";
import { BRIDGE_CLI_VERSION } from "./version";

// `process.argv` is `[nodeExecutable, scriptPath, ...userArgs]`.
const CLI_ARGS_START_INDEX = 2;

/** P1-C: land the user's Profile (standards → CLAUDE.md managed block, skills →
 * SKILL.md, MCP → .mcp.json + memory entry) into `~/.claude`, idempotently. The
 * `sync` subcommand and (best-effort) the pre-session auto-sync both call this. */
function runProfileSync(config: {
	force?: boolean;
	projectId?: string;
	serverUrl: string;
	token: string;
}): Promise<{ changed: boolean; version: number }> {
	return syncProfile({
		bridgeToken: config.token,
		fetchBundle: createBundleFetcher({
			serverUrl: config.serverUrl,
			token: config.token,
		}),
		force: config.force,
		fs: defaultSyncFs(),
		// Slice B: the running executable is what the injected hooks re-invoke as
		// `<exe> hook-emit <Event>`. For the compiled single-binary CLI this is the
		// binary itself; in dev (`tsx`/node) it's the node runtime, which still
		// resolves — the hook just won't carry the script path, acceptable off-prod.
		hookCommandPath: process.execPath,
		log: (message) => process.stdout.write(`[sync] ${message}\n`),
		projectId: config.projectId,
		roots: defaultSyncRoots(),
		serverUrl: config.serverUrl,
	});
}

/** `sync` mode: land the Profile and exit. */
async function startSync(args: SyncCliArgs): Promise<void> {
	await runProfileSync({
		force: args.force,
		projectId: args.projectId,
		serverUrl: args.serverUrl,
		token: args.token,
	});
}

/** The direct `--session` mode drove a single agent through the (now removed)
 * structured adapter/relay stack. The PTY rewrite (P2-3) replaces it: run the
 * `--client` daemon and open a terminal from the web, which spawns a real PTY
 * on this machine over the byte transport. Kept as an explicit, actionable
 * error rather than a silent no-op so any stale launch command is obvious. */
function startSessionClient(_args: SessionCliArgs): Promise<void> {
	return Promise.reject(
		new Error(
			"The direct `--session` mode was removed in the PTY rewrite. " +
				"Run the client daemon (`agent-cli --client`) and open a terminal " +
				"from the web instead."
		)
	);
}

/** `--client` (S1-T3 + S25-T1): pair-or-load the Computer identity, register
 * with the detected inventory, and heartbeat until SIGINT/SIGTERM. The launch
 * pipeline that drove structured agent sessions is gone (P2-3); what remains is
 * project clone processing (delivered via heartbeat `pendingCommands`) and the
 * binary PTY plane, which spawns/attaches real ptys on a viewer's OPEN. */
/** Everything after `--client` is wired here; the log seam is shared. */
const logStderr = (message: string) => process.stderr.write(`${message}\n`);

interface ClientChannelDeps {
	args: ClientCliArgs;
	clock: () => number;
	signal: AbortSignal;
	transport: ReturnType<typeof createComputerTransport>;
}

/** DP-WS: the JSON control channel starter — fire-and-forget like the PTY
 * plane; it reconnects with backoff until shutdown and dispatches the real-time
 * project_query / workspace_query frames to their executors (both answering over
 * the SAME oRPC submit path). */
function makeStartControlChannel(deps: ClientChannelDeps) {
	const projectQueryHandler = createProjectQueryHandler({
		log: logStderr,
		submitResult: (input) => deps.transport.submitProjectQueryResult(input),
	});
	const workspaceQueryHandler = createWorkspaceQueryHandler({
		log: logStderr,
		submitResult: (input) => deps.transport.submitProjectQueryResult(input),
	});
	return (identity: ComputerIdentity) => {
		runControlChannel({
			identity,
			log: logStderr,
			nextTimestamp: deps.clock,
			onProjectQuery: (command) => {
				projectQueryHandler.handle(command).catch(() => undefined);
			},
			onWorkspaceQuery: (command) => {
				workspaceQueryHandler.handle(command).catch(() => undefined);
			},
			serverUrl: deps.args.serverUrl,
			signal: deps.signal,
		}).catch((error: unknown) => {
			logStderr(
				`control channel stopped: ${error instanceof Error ? error.message : String(error)}`
			);
		});
	};
}

/** P2-3a: the binary PTY plane starter — serves a viewer's OPEN by
 * spawning/attaching a real pty on this machine; reconnects until shutdown. */
function makeStartPtyTransport(deps: ClientChannelDeps) {
	return (identity: ComputerIdentity) => {
		runPtyTransport({
			identity,
			log: logStderr,
			nextTimestamp: deps.clock,
			serverUrl: deps.args.serverUrl,
			signal: deps.signal,
			wsFactory: defaultPtyWsFactory,
		}).catch((error: unknown) => {
			logStderr(
				`pty transport stopped: ${error instanceof Error ? error.message : String(error)}`
			);
		});
	};
}

async function startComputerClient(args: ClientCliArgs): Promise<void> {
	const controller = new AbortController();
	process.once("SIGINT", () => controller.abort());
	process.once("SIGTERM", () => controller.abort());
	process.stdout.write(`Connecting ${args.name} → ${args.serverUrl}\n`);
	// ONE strictly-increasing clock across the HTTP and WS planes — the
	// server's replay guard is per-computer, not per-transport.
	const clock = createMonotonicTimestamp();
	const transport = createComputerTransport({
		now: clock,
		serverUrl: args.serverUrl,
	});
	const channelDeps: ClientChannelDeps = {
		args,
		clock,
		signal: controller.signal,
		transport,
	};
	// Q2 clone_project processing — delivered through the heartbeat's
	// `pendingCommands` (the WS control channel that also carried it went away
	// with the structured launch pipeline).
	const cloneHandler = createCloneHandler({
		ackClone: (projectId) => transport.ackClone(projectId),
		log: logStderr,
		reportCloneResult: (input) => transport.reportCloneResult(input),
	});
	await runComputerClient(args, {
		cloneHandler,
		detectInventory: () => detectComputerInventory(),
		generateKeyPair: generateComputerKeyPair,
		identityFile: createIdentityFile(),
		log: (message) => process.stdout.write(`${message}\n`),
		onHeartbeatError: (error) =>
			process.stderr.write(`Computer heartbeat failed: ${error.message}\n`),
		platformInfo: {
			arch: arch(),
			clientVersion: BRIDGE_CLI_VERSION,
			platform: platform(),
		},
		startControlChannel: makeStartControlChannel(channelDeps),
		startPtyTransport: makeStartPtyTransport(channelDeps),
		transport,
		wait: createHeartbeatWait(controller.signal),
	});
}

async function main(): Promise<void> {
	const rawArgv = process.argv.slice(CLI_ARGS_START_INDEX);

	// Slice B: `agent-cli hook-emit <Event>` — the short-lived subprocess claude
	// spawns per hook event. It reads the hook JSON on stdin and hands one line
	// to the daemon's local socket, then exits. Strictly fire-and-forget (never
	// throws / never writes stderr), so it can never disturb claude — handled
	// before arg parsing since it takes a bare positional, not the flag grammar.
	if (rawArgv[0] === "hook-emit") {
		await runHookEmit(rawArgv[1] ?? "", defaultHookEmitDeps());
		return;
	}

	const infoOutput = handleInfoFlags(rawArgv, BRIDGE_CLI_VERSION);
	if (infoOutput !== undefined) {
		process.stdout.write(`${infoOutput}\n`);
		return;
	}

	const args = parseArgs(rawArgv);
	await dispatchCli(args, {
		startClient: startComputerClient,
		startSession: startSessionClient,
		startSync,
	});
}

main().catch((error: unknown) => {
	process.stderr.write(
		`${error instanceof Error ? error.message : String(error)}\n`
	);
	process.exitCode = 1;
});
