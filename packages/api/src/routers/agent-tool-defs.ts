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
import {
	buildOpenConnectorToolDefs,
	type OpenConnectorService,
} from "@better-agent/agent/tool/openconnector-tools";
import type { SkillActivation } from "@better-agent/agent/tool/tool-skill";
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

// Every configured, non-virtual provider connection of one open-connector
// account, turned into runtime tool defs. Failures are logged and yield no
// tools, so a broken instance never breaks the whole turn.
export async function safeOpenConnectorDefs(
	service: OpenConnectorService | null
): Promise<ToolDef[]> {
	if (!service) {
		return [];
	}
	try {
		const connections = await service.listConnections();
		const services = [
			...new Set(
				connections
					.filter((c) => c.configured && !c.virtual)
					.map((c) => c.service)
			),
		];
		if (services.length === 0) {
			return [];
		}
		return await buildOpenConnectorToolDefs(service, services);
	} catch (error) {
		log.error(
			"tools",
			`open-connector defs failed: ${error instanceof Error ? error.message : String(error)}`
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

// One assigned skill resolved for on-demand loading via the `skill` tool: its
// playbook + the names of every tool it can use. A built-in finance skill
// brings no tools of its own — its allowedTools name the agent's OWN (deferred)
// finance-mcp tools, which the `skill` tool simply reveals. A user skill may
// also bring its own builtin/MCP tools, registered (deferred) below so they
// exist to reveal.
async function resolveSkillActivation(
	context: Context,
	skill: SkillRow
): Promise<{ activation: SkillActivation; ownDefs: ToolDef[] }> {
	const ownDefs = await assembleSkillToolDefs(context, skill);
	const toolNames = [
		...new Set([...(skill.allowedTools ?? []), ...ownDefs.map((d) => d.name)]),
	];
	return {
		activation: {
			name: skill.name,
			description: skill.description ?? "",
			instructions: skill.instructions ?? "",
			toolNames,
		},
		ownDefs,
	};
}

// An agent's tools + skills. Base tools = every authenticated composio toolkit,
// each MCP server's tools, and enabled builtins. Assigned skills are loadable
// on demand via the `skill` tool (runtime), so their own tools are registered
// deferred here and their activation metadata returned alongside the defs.
export async function assembleAgentToolDefs(
	context: Context,
	agent: {
		builtinTools: string[];
		composioAccountIds: string[];
		openConnectorAccountIds?: string[];
		mcpServerIds: string[];
		toolAllowlist?: string[] | null;
	},
	skills: SkillRow[] = []
): Promise<{ defs: ToolDef[]; skills: SkillActivation[] }> {
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
	const perOc = await Promise.all(
		(agent.openConnectorAccountIds ?? []).map(async (id) =>
			safeOpenConnectorDefs(await context.services.openConnector(id))
		)
	);
	const allowlist = agent.toolAllowlist ?? null;
	const baseDefs = [
		...shapeSourceDefs(
			[...perAccount.flat(), ...perServer.flat(), ...perOc.flat()],
			allowlist
		),
		...buildBuiltinToolDefs(agent.builtinTools ?? []),
	];
	const resolved = await Promise.all(
		skills.map((skill) => resolveSkillActivation(context, skill))
	);
	const skillDefs = resolved
		.flatMap((r) => r.ownDefs)
		.map((def) => ({ ...def, defer: true }));
	// Base LAST so the agent's own copy of a tool (e.g. a visible builtin) wins
	// over a skill re-declaring the same name as deferred — dedupe keeps last.
	return {
		defs: dedupeByName([...skillDefs, ...baseDefs]),
		skills: resolved.map((r) => r.activation),
	};
}
