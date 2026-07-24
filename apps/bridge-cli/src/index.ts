#!/usr/bin/env node
import { arch, platform } from "node:os";
import { generateComputerKeyPair } from "@better-agent/agent/crypto/computer-signature";
import { AGENT_CLI, selectAdapter } from "./adapters";
import { findOnPath } from "./adapters/process-io";
import type { AgentKind } from "./adapters/types";
import {
	type ClientCliArgs,
	handleInfoFlags,
	parseArgs,
	type SessionCliArgs,
	type SyncCliArgs,
} from "./args";
import { dispatchCli } from "./cli-dispatch";
import { createHeartbeatWait, runComputerClient } from "./computer-client";
import { createIdentityFile } from "./computer-identity";
import {
	createComputerTransport,
	createMonotonicTimestamp,
} from "./computer-transport";
import { createCuaController } from "./cua/cua-controller";
import { detectComputerInventory } from "./detect-inventory";
import { createBundleFetcher } from "./profile-sync/bundle-client";
import { defaultSyncFs, defaultSyncRoots } from "./profile-sync/fs-ports";
import { syncProfile } from "./profile-sync/sync";
import { createRelayTransport } from "./relay-transport";
import { runRestartLoop } from "./restart-loop";
import { createTaskLaunchRuntime } from "./task-launch/launch-wiring";
import { BRIDGE_CLI_VERSION } from "./version";

// `process.argv` is `[nodeExecutable, scriptPath, ...userArgs]`.
const CLI_ARGS_START_INDEX = 2;

/** Fails fast with a precise install hint when the chosen agent's CLI isn't on
 * PATH. The standalone binary bundles no agent CLI, so this beats a confusing
 * mid-session spawn/SDK error and tells a new user exactly what to install. */
function requireAgentCli(agentKind: AgentKind): void {
	const cli = AGENT_CLI[agentKind];
	if (!findOnPath(cli.binary)) {
		process.stderr.write(
			`✗ '${cli.binary}' not found on PATH — the ${agentKind} agent needs it.\n` +
				`  Install:  ${cli.install}\n` +
				`  Then ensure '${cli.binary}' is on your PATH and retry.\n`
		);
		process.exit(1);
	}
}

/** Registers the bridge session and starts the adapter — split out of `main`
 * purely to keep it under the line gate. Session registration happens BEFORE
 * starting the adapter so the server can hand back the token's persisted
 * startup config (Phase 4) in time for `adapter.start` to apply it
 * (appendSystemPrompt, maxTurns, …). */
async function startAgentSession(
	args: SessionCliArgs,
	adapter: ReturnType<typeof selectAdapter>,
	transport: ReturnType<typeof createRelayTransport>
) {
	const { sessionId, config, mcpServers, skills } =
		await transport.startSession({
			agentKind: args.agentKind,
			label: args.label,
		});
	const handle = await adapter.start(args.dir, {
		resume: args.resume,
		config: config ?? undefined,
		mcpServers,
		skills,
	});
	return { sessionId, handle };
}

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

/** The pre-existing session mode, verbatim — extracted from `main` so the
 * mode dispatch stays a pure seam with zero session behavior change. P1-C adds
 * one best-effort auto-sync before the adapter starts, so a project session
 * always launches against the freshest Profile; a sync failure never blocks the
 * session (the server-forwarded skills/MCP still apply). */
async function startSessionClient(args: SessionCliArgs): Promise<void> {
	const adapter = selectAdapter(args.agentKind, {
		opencodeTransport: args.opencodeTransport,
	});
	requireAgentCli(args.agentKind);

	try {
		await runProfileSync({ serverUrl: args.serverUrl, token: args.token });
	} catch (error) {
		process.stderr.write(
			`[sync] Profile sync skipped: ${error instanceof Error ? error.message : String(error)}\n`
		);
	}

	const transport = createRelayTransport({
		serverUrl: args.serverUrl,
		token: args.token,
	});
	process.stdout.write(
		`Starting ${args.agentKind} in ${args.dir} → ${args.serverUrl}\n`
	);
	const { sessionId, handle } = await startAgentSession(
		args,
		adapter,
		transport
	);
	// --cua: the desktop VM lifecycle, driven by the web's Start/Stop buttons
	// (control commands) and threaded through the restart loop so an in-place
	// agent restart never kills it. Auto-started once here for convenience; VM
	// boot runs in the background and never blocks the agent loop.
	const cuaEnabled = args.cua || args.cuaVncUrl !== undefined;
	const cua = cuaEnabled
		? createCuaController({
				serverUrl: args.serverUrl,
				token: args.token,
				sessionId,
				vncUrlOverride: args.cuaVncUrl,
				vmName: args.cuaVm,
				image: args.cuaImage,
				log: (message) => process.stdout.write(`[cua] ${message}\n`),
				reportVnc: (vncEndpoint) =>
					transport.reportVnc?.({ sessionId, vncEndpoint }) ??
					Promise.resolve(),
			})
		: undefined;
	cua?.startVm();
	try {
		await runRestartLoop({ adapter, args, cua, handle, sessionId, transport });
	} finally {
		await cua?.dispose();
	}
}

/** `--client` (S1-T3 + S25-T1): pair-or-load the Computer identity, register
 * with the detected inventory, and heartbeat until SIGINT/SIGTERM — now with
 * the launch pipeline attached, so delivered Launch Commands (WS push or
 * heartbeat fallback) start managed runtimes in Task workspaces. */
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
	const launch = createTaskLaunchRuntime({
		log: (message) => process.stderr.write(`${message}\n`),
		nextTimestamp: clock,
		serverUrl: args.serverUrl,
		signal: controller.signal,
		transport,
	});
	await runComputerClient(args, {
		cloneHandler: launch.cloneHandler,
		detectInventory: () => detectComputerInventory(),
		generateKeyPair: generateComputerKeyPair,
		identityFile: createIdentityFile(),
		launchHandler: launch.launchHandler,
		log: (message) => process.stdout.write(`${message}\n`),
		onHeartbeatError: (error) =>
			process.stderr.write(`Computer heartbeat failed: ${error.message}\n`),
		platformInfo: {
			arch: arch(),
			clientVersion: BRIDGE_CLI_VERSION,
			platform: platform(),
		},
		startControlChannel: launch.startControlChannel,
		transport,
		wait: createHeartbeatWait(controller.signal),
	});
}

async function main(): Promise<void> {
	const rawArgv = process.argv.slice(CLI_ARGS_START_INDEX);
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
