import type {
	CliArgs,
	ClientCliArgs,
	SessionCliArgs,
	SyncCliArgs,
} from "./args";

// The single seam between the CLI modes. Session mode's handler receives the
// exact args shape it always has; client mode structurally cannot reach Agent
// startup because its handler never sees an agentKind at all; sync mode (P1-C)
// lands the Profile and exits.

export interface CliModeHandlers {
	startClient(args: ClientCliArgs): Promise<void>;
	startSession(args: SessionCliArgs): Promise<void>;
	startSync(args: SyncCliArgs): Promise<void>;
}

export async function dispatchCli(
	args: CliArgs,
	handlers: CliModeHandlers
): Promise<void> {
	if (args.mode === "client") {
		await handlers.startClient(args);
		return;
	}
	if (args.mode === "sync") {
		await handlers.startSync(args);
		return;
	}
	await handlers.startSession(args);
}
