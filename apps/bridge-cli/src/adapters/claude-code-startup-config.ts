import type {
	McpServerConfig,
	PermissionMode,
} from "@anthropic-ai/claude-agent-sdk";
import type { AgentStartConfig, ResolvedMcpServer } from "./types";

// The SDK `query()` options claude-code.ts derives from the bridge token's
// persisted startup config (Phase 4 + R2-b), split out of claude-code.ts to
// keep that file under the repo's 300-line limit (and — since each field is
// independently optional — keep `startClaudeQuery`'s eslint `complexity`
// under the repo's gate: this file absorbs that branching instead).

/** The SDK's full `PermissionMode` enum — narrows a wire string (from the
 * web's `control: setPermissionMode` command, or the persisted startup
 * config) before handing it to the SDK, instead of an unchecked type
 * assertion. */
const PERMISSION_MODES = new Set<string>([
	"default",
	"acceptEdits",
	"bypassPermissions",
	"plan",
	"dontAsk",
	"auto",
]);

export function isPermissionMode(value: string): value is PermissionMode {
	return PERMISSION_MODES.has(value);
}

/** Builds the SDK `systemPrompt` option: preset+append keeps claude's default
 * prompt and appends the user's instructions (a bare string would REPLACE it). */
export function claudeSystemPromptOption(
	config: { appendSystemPrompt?: string } | undefined
) {
	return config?.appendSystemPrompt
		? {
				append: config.appendSystemPrompt,
				preset: "claude_code" as const,
				type: "preset" as const,
			}
		: undefined;
}

/** Narrows the persisted config's `permissionMode` (a plain wire string) to
 * the SDK's `PermissionMode` enum, same check `setPermissionMode` uses for
 * the LIVE control — an unrecognized value is dropped rather than handed to
 * `query()` unchecked. */
export function startupPermissionMode(
	config: { permissionMode?: string } | undefined
): PermissionMode | undefined {
	return config?.permissionMode && isPermissionMode(config.permissionMode)
		? config.permissionMode
		: undefined;
}

/** Maps the CLI's resolved MCP servers (R5-b) to the SDK's `mcpServers`
 * option/`setMcpServers` argument: a name→config record where each server is
 * an HTTP transport (`type: "http"`) carrying its already-decrypted auth
 * headers. Used both at start (`query({ options: { mcpServers } })`) and LIVE
 * (`query.setMcpServers`). An empty input yields an empty record, which the
 * SDK treats as "no SDK-provided servers." */
export function claudeMcpServers(
	servers: ResolvedMcpServer[] | undefined
): Record<string, McpServerConfig> {
	const record: Record<string, McpServerConfig> = {};
	for (const server of servers ?? []) {
		record[server.name] = {
			type: "http",
			url: server.url,
			headers: server.headers,
		};
	}
	return record;
}

/** The subset of the SDK's `query()` options this file derives from the
 * persisted startup config — spread into `startClaudeQuery`'s options object
 * as one expression, rather than one optional-chained field at a time.
 *
 * `allowDangerouslySkipPermissions` is ALWAYS `true`: it's the SDK's
 * spawn-time gate that merely PERMITS the `bypassPermissions` mode — it does
 * not itself change how tools are gated (the live `permissionMode` still
 * governs that; a `default`/`plan`/… session keeps prompting). We set it on
 * every claude session because `bypassPermissions` is now an offered mode
 * (see session-capabilities.ts) and the flag is spawn-only — the SDK exposes
 * no runtime control request to toggle it — so without it a LIVE
 * `setPermissionMode('bypassPermissions')` would be silently refused
 * (`bypass_permissions_disabled`) rather than take effect. Setting it up front
 * lets the owner switch a running session into full-auto with no restart. */
export function configQueryOptions(config: AgentStartConfig | undefined): {
	allowDangerouslySkipPermissions: true;
	effort: AgentStartConfig["effort"];
	maxBudgetUsd: number | undefined;
	maxTurns: number | undefined;
	model: string | undefined;
	permissionMode: PermissionMode | undefined;
	systemPrompt: ReturnType<typeof claudeSystemPromptOption>;
} {
	return {
		systemPrompt: claudeSystemPromptOption(config),
		maxTurns: config?.maxTurns,
		maxBudgetUsd: config?.maxBudgetUsd,
		effort: config?.effort,
		model: config?.model,
		permissionMode: startupPermissionMode(config),
		allowDangerouslySkipPermissions: true,
	};
}
