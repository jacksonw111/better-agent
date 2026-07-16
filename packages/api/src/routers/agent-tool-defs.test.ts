import type { SkillRow } from "@better-agent/agent/ports";
import type { McpService } from "@better-agent/agent/tool/mcp-tools";
import type { OpenConnectorService } from "@better-agent/agent/tool/openconnector-tools";
import { describe, expect, it } from "vitest";
import type { Context } from "../context";
import { assembleAgentToolDefs } from "./agent-tool-defs";

// Skills T3: assigned skills are loadable on demand via the runtime `skill`
// tool. assembleAgentToolDefs registers each skill's OWN tools (deferred) and
// returns activation metadata (name/description/instructions/toolNames); the
// finance_* names a built-in skill references are the agent's own tools, so
// they appear only in the activation's toolNames, not as new defs.

const BASE_AGENT = {
	builtinTools: [],
	composioAccountIds: [],
	mcpServerIds: [],
	toolAllowlist: null,
};

function fakeSkill(overrides: Partial<SkillRow> = {}): SkillRow {
	const now = new Date();
	return {
		id: "skill-1",
		userId: "user-1",
		name: "deploy",
		description: "Ship a release",
		instructions: "do the thing",
		allowedTools: null,
		mcpServerIds: null,
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

function fakeMcpService(tools: McpService): McpService {
	return tools;
}

function contextWithMcp(mcp: (serverId: string) => Promise<McpService | null>) {
	return {
		services: {
			composio: () => Promise.resolve(null),
			openConnector: () => Promise.resolve(null),
			mcp,
		},
	} as unknown as Context;
}

describe("assembleAgentToolDefs — Skills T3", () => {
	it("returns base tools and no activations when no skills are assigned", async () => {
		const context = contextWithMcp(() => Promise.resolve(null));
		const result = await assembleAgentToolDefs(context, BASE_AGENT);
		expect(result.defs).toEqual([]);
		expect(result.skills).toEqual([]);
	});

	it("registers a skill's own builtin tool (deferred) and lists it in the activation", async () => {
		const context = contextWithMcp(() => Promise.resolve(null));
		const skill = fakeSkill({ allowedTools: ["get_current_time"] });
		const { defs, skills } = await assembleAgentToolDefs(context, BASE_AGENT, [
			skill,
		]);
		expect(defs.map((d) => d.name)).toEqual(["get_current_time"]);
		expect(defs.every((d) => d.defer)).toBe(true); // hidden until loaded
		expect(skills).toHaveLength(1);
		expect(skills[0]).toMatchObject({
			name: "deploy",
			instructions: "do the thing",
			toolNames: ["get_current_time"],
		});
	});

	it("references the agent's OWN tools (finance_*) only in toolNames, not as new defs", async () => {
		const context = contextWithMcp(() => Promise.resolve(null));
		// finance_* aren't builtins — they come from the agent's finance-mcp, so
		// assembleSkillToolDefs adds no def; the name lives only in toolNames.
		const skill = fakeSkill({ allowedTools: ["finance_market_breadth"] });
		const { defs, skills } = await assembleAgentToolDefs(context, BASE_AGENT, [
			skill,
		]);
		expect(defs).toEqual([]);
		expect(skills[0]?.toolNames).toEqual(["finance_market_breadth"]);
	});
});

describe("assembleAgentToolDefs — Skills T3 (mcp + dedupe)", () => {
	it("registers a skill's mcpServerIds tools deferred and in toolNames", async () => {
		const mcpService = fakeMcpService({
			listTools: () =>
				Promise.resolve([
					{ name: "SKILL_TOOL", description: "d", parameters: {} },
				]),
			execute: () => Promise.resolve({ output: "ok" }),
		});
		const context = contextWithMcp((serverId) =>
			Promise.resolve(serverId === "mcp-1" ? mcpService : null)
		);
		const skill = fakeSkill({ mcpServerIds: ["mcp-1"] });
		const { defs, skills } = await assembleAgentToolDefs(context, BASE_AGENT, [
			skill,
		]);
		expect(defs.map((d) => d.name)).toEqual(["SKILL_TOOL"]);
		expect(skills[0]?.toolNames).toContain("SKILL_TOOL");
	});

	it("the agent's own visible tool wins over a skill re-declaring it", async () => {
		const context = contextWithMcp(() => Promise.resolve(null));
		const agent = { ...BASE_AGENT, builtinTools: ["get_current_time"] };
		const skill = fakeSkill({ allowedTools: ["get_current_time"] });
		const { defs } = await assembleAgentToolDefs(context, agent, [skill]);
		// Deduped by name, base (visible) wins over the skill's deferred copy.
		expect(defs.map((d) => d.name)).toEqual(["get_current_time"]);
		expect(defs[0]?.defer).toBeFalsy();
	});
});

function fakeOpenConnector(): OpenConnectorService {
	return {
		connectWithKey: () => Promise.resolve({ configured: true }),
		disconnect: () => Promise.resolve(),
		execute: () => Promise.resolve({ output: "ok", isError: false }),
		listProviders: () => Promise.resolve([]),
		listConnections: () =>
			Promise.resolve([
				{
					id: "c1",
					service: "github",
					connectionName: "gh",
					authType: "api_key",
					configured: true,
					virtual: false,
				},
				{
					id: "c2",
					service: "x",
					connectionName: "x",
					authType: "api_key",
					configured: true,
					virtual: true,
				},
			]),
		listActions: (services) =>
			Promise.resolve(
				services.includes("github")
					? [
							{
								id: "github.get_repo",
								service: "github",
								name: "get_repo",
								description: "Get a repo",
								inputSchema: {},
							},
						]
					: []
			),
	};
}

describe("assembleAgentToolDefs — OpenConnector", () => {
	it("builds tools for configured, non-virtual connections only", async () => {
		const service = fakeOpenConnector();
		const context = {
			services: {
				composio: () => Promise.resolve(null),
				openConnector: () => Promise.resolve(service),
				mcp: () => Promise.resolve(null),
			},
		} as unknown as Context;
		const agent = { ...BASE_AGENT, openConnectorAccountIds: ["oc-1"] };
		const { defs } = await assembleAgentToolDefs(context, agent);
		expect(defs.map((d) => d.name)).toEqual(["github.get_repo"]);
	});
});
