#!/usr/bin/env node
import { AGENT_CLI, selectAdapter } from "./adapters";
import { findOnPath } from "./adapters/process-io";
import type { AgentKind } from "./adapters/types";
import { parseArgs } from "./args";
import { runBridgeSession } from "./relay-client";
import { createRelayTransport } from "./relay-transport";

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

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(CLI_ARGS_START_INDEX));
	const adapter = selectAdapter(args.agentKind);
	requireAgentCli(args.agentKind);

	const transport = createRelayTransport({
		serverUrl: args.serverUrl,
		token: args.token,
	});
	process.stdout.write(
		`Starting ${args.agentKind} in ${args.dir} → ${args.serverUrl}\n`
	);
	// Register the session BEFORE starting the adapter so the server can hand
	// back the token's persisted startup config (Phase 4) in time for
	// `adapter.start` to apply it (appendSystemPrompt, maxTurns, …).
	const { sessionId, config } = await transport.startSession({
		agentKind: args.agentKind,
		label: args.label,
	});
	const handle = await adapter.start(args.dir, {
		resume: args.resume,
		config: config ?? undefined,
	});
	const controller = new AbortController();

	const stop = () => {
		controller.abort();
		handle.stop();
	};
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);

	const { sessionId: endedSessionId } = await runBridgeSession({
		transport,
		handle,
		sessionId,
		signal: controller.signal,
		onStart: (id) =>
			process.stdout.write(
				`Connected. Session ${id}. Drive it from the web Local Agent view; input here is forwarded to the agent.\n`
			),
		pollOptions: args.debug
			? {
					onCommands: (commands) =>
						process.stderr.write(`← command(s): ${JSON.stringify(commands)}\n`),
				}
			: undefined,
		forwardOptions: {
			onWarning: (message) => process.stderr.write(`${message}\n`),
			onEvent: args.debug
				? (event) => process.stderr.write(`→ event: ${JSON.stringify(event)}\n`)
				: undefined,
		},
	});

	process.stdout.write(`Bridge session ended: ${endedSessionId}\n`);
}

main().catch((error: unknown) => {
	process.stderr.write(
		`${error instanceof Error ? error.message : String(error)}\n`
	);
	process.exitCode = 1;
});
