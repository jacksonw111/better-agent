import type { SkillRow } from "@better-agent/agent/ports";
import type { McpService } from "@better-agent/agent/tool/mcp-tools";
import { describe, expect, it } from "vitest";
import type { Context } from "../context";
import { assembleAgentToolDefs } from "./agent-tool-defs";

// Skills T3 tool-folding: an ACTIVE skill's `allowedTools` (builtin ids) and
// `mcpServerIds` get ADDED to the turn's toolset, over and above whatever the
// base agent already carries (see agent-tool-defs.ts's assembleSkillToolDefs).

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
			mcp,
		},
	} as unknown as Context;
}

describe("assembleAgentToolDefs — Skills T3 tool-folding", () => {
	it("returns only the agent's own tools when no skill is active", async () => {
		const context = contextWithMcp(() => Promise.resolve(null));
		const defs = await assembleAgentToolDefs(context, BASE_AGENT, null);
		expect(defs).toEqual([]);
	});

	it("adds the active skill's allowedTools (builtin ids) to the toolset", async () => {
		const context = contextWithMcp(() => Promise.resolve(null));
		const skill = fakeSkill({ allowedTools: ["get_current_time"] });
		const defs = await assembleAgentToolDefs(context, BASE_AGENT, skill);
		expect(defs.map((d) => d.name)).toEqual(["get_current_time"]);
	});

	it("resolves the active skill's mcpServerIds the same way the agent's own are", async () => {
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
		const defs = await assembleAgentToolDefs(context, BASE_AGENT, skill);
		expect(defs.map((d) => d.name)).toEqual(["SKILL_TOOL"]);
	});

	it("folds skill tools alongside the agent's own builtin tools", async () => {
		const context = contextWithMcp(() => Promise.resolve(null));
		const agent = { ...BASE_AGENT, builtinTools: ["get_current_time"] };
		const skill = fakeSkill({ allowedTools: ["get_current_time"] });
		const defs = await assembleAgentToolDefs(context, agent, skill);
		// De-duped by name: the agent already carries get_current_time.
		expect(defs.map((d) => d.name)).toEqual(["get_current_time"]);
	});

	it("a null/absent activeSkill leaves the base toolset untouched", async () => {
		const context = contextWithMcp(() => Promise.resolve(null));
		const agent = { ...BASE_AGENT, builtinTools: ["get_current_time"] };
		const defs = await assembleAgentToolDefs(context, agent);
		expect(defs.map((d) => d.name)).toEqual(["get_current_time"]);
	});
});
