import type { SkillRow } from "@better-agent/agent/ports";
import { buildBuiltinToolDefs } from "@better-agent/agent/tool/builtin-tools";
import {
	buildComposioToolDefs,
	type ComposioService,
} from "@better-agent/agent/tool/composio-tools";
import {
	buildMcpToolDefs,
	type McpService,
} from "@better-agent/agent/tool/mcp-tools";
import type { ToolDef } from "@better-agent/agent/tool/types";
import { log } from "evlog";
import type { Context } from "../context";

// `scope` is the composio "user" scope — here a composio account id. Builds the
// tool defs for every authenticated toolkit of that account.
export async function safeComposioDefs(
	service: ComposioService | null,
	scope: string
): Promise<ToolDef[]> {
	if (!service) {
		return [];
	}
	try {
		const connections = await service.listConnections(scope);
		const toolkits = [
			...new Set(connections.filter((c) => c.active).map((c) => c.toolkitSlug)),
		];
		if (toolkits.length === 0) {
			return [];
		}
		return await buildComposioToolDefs(service, scope, toolkits);
	} catch (error) {
		log.error(
			"tools",
			`composio defs failed (${scope}): ${error instanceof Error ? error.message : String(error)}`
		);
		return [];
	}
}

// Tools from one linked MCP server; failures are logged server-side and yield
// no tools, so a broken server never breaks the whole turn.
export async function safeMcpDefs(
	service: McpService | null
): Promise<ToolDef[]> {
	if (!service) {
		return [];
	}
	try {
		return await buildMcpToolDefs(service);
	} catch (error) {
		log.error(
			"tools",
			`mcp defs failed: ${error instanceof Error ? error.message : String(error)}`
		);
		return [];
	}
}

// Composio/MCP tools are bulky and numerous: mark them deferrable (hidden
// behind search_tools past the runtime's threshold) and honor the agent's
// optional tool allowlist.
function shapeSourceDefs(
	defs: ToolDef[],
	allowlist: string[] | null
): ToolDef[] {
	const allowed = allowlist
		? defs.filter((def) => allowlist.includes(def.name))
		: defs;
	return allowed.map((def) => ({ ...def, defer: true }));
}

// Skills T3 tool-folding: an ACTIVE skill (see skill-activation.ts) may bring
// its own builtin tools + MCP servers, over and above whatever the base agent
// already has, so the skill's playbook can actually call them. MCP servers
// are resolved the exact same way the agent's own mcpServerIds are (line ~90
// above) — `context.services.mcp` owner-scopes internally (a skill's
// mcpServerIds are only ever ids the skill's owner set via the skills router).
async function assembleSkillToolDefs(
	context: Context,
	skill: SkillRow
): Promise<ToolDef[]> {
	const perServer = await Promise.all(
		(skill.mcpServerIds ?? []).map(async (serverId) =>
			safeMcpDefs(await context.services.mcp(serverId))
		)
	);
	return [
		...perServer.flat(),
		...buildBuiltinToolDefs(skill.allowedTools ?? []),
	];
}

// Last-wins de-dupe by tool name — buildTools() (packages/agent/src/tool/registry.ts)
// throws on a duplicate name, so if a skill re-declares a tool the base agent
// already carries, the skill's copy (appended last) is the one that survives.
function dedupeByName(defs: ToolDef[]): ToolDef[] {
	const byName = new Map(defs.map((def) => [def.name, def]));
	return [...byName.values()];
}

// An agent's tools: every authenticated toolkit of each linked composio account,
// each linked MCP server's tools, plus its enabled built-in tools — plus, when
// `activeSkill` is passed (Skills T3), that skill's own tools folded in.
export async function assembleAgentToolDefs(
	context: Context,
	agent: {
		builtinTools: string[];
		composioAccountIds: string[];
		mcpServerIds: string[];
		toolAllowlist?: string[] | null;
	},
	activeSkill?: SkillRow | null
): Promise<ToolDef[]> {
	const perAccount = await Promise.all(
		(agent.composioAccountIds ?? []).map(async (accountId) => {
			const service = await context.services.composio(accountId);
			return safeComposioDefs(service, accountId);
		})
	);
	const perServer = await Promise.all(
		(agent.mcpServerIds ?? []).map(async (serverId) =>
			safeMcpDefs(await context.services.mcp(serverId))
		)
	);
	const allowlist = agent.toolAllowlist ?? null;
	const baseDefs = [
		...shapeSourceDefs([...perAccount.flat(), ...perServer.flat()], allowlist),
		...buildBuiltinToolDefs(agent.builtinTools ?? []),
	];
	if (!activeSkill) {
		return baseDefs;
	}
	const skillDefs = await assembleSkillToolDefs(context, activeSkill);
	return dedupeByName([...baseDefs, ...skillDefs]);
}
