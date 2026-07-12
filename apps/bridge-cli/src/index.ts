#!/usr/bin/env node
import { AGENT_CLI, selectAdapter } from "./adapters";
import { findOnPath } from "./adapters/process-io";
import type { AgentKind } from "./adapters/types";
import { handleInfoFlags, parseArgs } from "./args";
import { type CuaSession, startCuaSession } from "./cua/cua-session";
import { createRelayTransport } from "./relay-transport";
import { runRestartLoop } from "./restart-loop";
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
	args: ReturnType<typeof parseArgs>,
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

/** Starts CUA but never throws: a provisioning/boot failure is logged and
 * yields `undefined` (no remote desktop) instead of taking down the agent. */
async function startCuaSafely(
	options: Parameters<typeof startCuaSession>[0]
): Promise<CuaSession | undefined> {
	let session: CuaSession | undefined;
	try {
		session = await startCuaSession(options);
	} catch (error) {
		process.stderr.write(
			`[cua] ${error instanceof Error ? error.message : String(error)}\n`
		);
	}
	return session;
}

async function main(): Promise<void> {
	const rawArgv = process.argv.slice(CLI_ARGS_START_INDEX);
	const infoOutput = handleInfoFlags(rawArgv, BRIDGE_CLI_VERSION);
	if (infoOutput !== undefined) {
		process.stdout.write(`${infoOutput}\n`);
		return;
	}

	const args = parseArgs(rawArgv);
	const adapter = selectAdapter(args.agentKind, {
		opencodeTransport: args.opencodeTransport,
	});
	requireAgentCli(args.agentKind);

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
	// CUA runs alongside the agent session (VM boot can take a minute, so it
	// must not block the agent loop). A provisioning failure is logged, not
	// fatal — the agent still works, just without remote desktop.
	const cuaPromise: Promise<CuaSession | undefined> = args.cua
		? startCuaSafely({
				serverUrl: args.serverUrl,
				token: args.token,
				sessionId,
				log: (message) => process.stdout.write(`[cua] ${message}\n`),
			})
		: Promise.resolve(undefined);
	try {
		await runRestartLoop({ adapter, args, handle, sessionId, transport });
	} finally {
		await (await cuaPromise)?.stop();
	}
}

main().catch((error: unknown) => {
	process.stderr.write(
		`${error instanceof Error ? error.message : String(error)}\n`
	);
	process.exitCode = 1;
});
