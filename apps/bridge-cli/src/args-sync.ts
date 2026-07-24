// P1-C: the `sync` subcommand's args + parser, split out of args.ts so that
// file stays under the repo's 300-line cap. `parseSyncArgs` takes the already
// collected flag values (structurally a subset of args.ts's `CollectedFlags`)
// so it needs no import back into args.ts's flag machinery.

/** `sync` (P1-C): pull the Profile bundle and land it into `~/.claude`. Uses a
 * bridge token (`bt_…`) — the same credential a session uses — to authenticate
 * both the pull and the landed memory MCP entry. */
export interface SyncCliArgs {
	/** `--force`: re-land even when the Profile version is unchanged. */
	force: boolean;
	mode: "sync";
	/** `--project <id>`: bind the landed memory MCP entry to this project. */
	projectId: string | undefined;
	serverUrl: string;
	token: string;
}

/** The subset of collected flags `parseSyncArgs` reads. */
export interface SyncFlags {
	projectId?: string;
	serverUrl?: string;
	token?: string;
}

/** `sync` subcommand: bridge token + server required (env fallbacks apply, same
 * as session mode); `--force`/`--project` optional. */
export function parseSyncArgs(
	argv: string[],
	flags: SyncFlags,
	env: Record<string, string | undefined>
): SyncCliArgs {
	const token = flags.token ?? env.BETTER_AGENT_BRIDGE_TOKEN;
	if (token === undefined) {
		throw new Error("--token is required (or set BETTER_AGENT_BRIDGE_TOKEN)");
	}
	const serverUrl = flags.serverUrl ?? env.BETTER_AGENT_BRIDGE_SERVER;
	if (serverUrl === undefined) {
		throw new Error("--server is required (or set BETTER_AGENT_BRIDGE_SERVER)");
	}
	return {
		force: argv.includes("--force"),
		mode: "sync",
		projectId: flags.projectId,
		serverUrl,
		token,
	};
}
