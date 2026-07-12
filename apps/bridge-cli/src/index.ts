#!/usr/bin/env node
import { AGENT_CLI, selectAdapter } from "./adapters";
import { findOnPath } from "./adapters/process-io";
import type { AgentKind } from "./adapters/types";
import { handleInfoFlags, parseArgs } from "./args";
import { createCuaController } from "./cua/cua-controller";
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
	// --cua: the desktop VM lifecycle, driven by the web's Start/Stop buttons
	// (control commands) and threaded through the restart loop so an in-place
	// agent restart never kills it. Auto-started once here for convenience; VM
	// boot runs in the background and never blocks the agent loop.
	const cua = args.cua
		? createCuaController({
				serverUrl: args.serverUrl,
				token: args.token,
				sessionId,
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

main().catch((error: unknown) => {
	process.stderr.write(
		`${error instanceof Error ? error.message : String(error)}\n`
	);
	process.exitCode = 1;
});
