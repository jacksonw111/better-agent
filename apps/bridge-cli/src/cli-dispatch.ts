import type { CliArgs, ClientCliArgs, SessionCliArgs } from "./args";

// The single seam between the two CLI modes. Session mode's handler receives
// the exact args shape it always has; client mode structurally cannot reach
// Agent startup because its handler never sees an agentKind at all.

export interface CliModeHandlers {
	startClient(args: ClientCliArgs): Promise<void>;
	startSession(args: SessionCliArgs): Promise<void>;
}

export async function dispatchCli(
	args: CliArgs,
	handlers: CliModeHandlers
): Promise<void> {
	if (args.mode === "client") {
		await handlers.startClient(args);
		return;
	}
	await handlers.startSession(args);
}
