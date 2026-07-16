import { describe, expect, it } from "vitest";
import { buildSkillTool, SKILL_TOOL_NAME } from "./tool-skill";

const SKILLS = [
	{
		name: "market-review",
		description: "A股收盘复盘",
		instructions: "1. 定日期\n2. 看宽度",
		toolNames: ["finance_trade_calendar", "finance_market_breadth"],
	},
	{
		name: "deploy",
		description: "Ship a release",
		instructions: "run tests then ship",
		toolNames: ["get_current_time"],
	},
];

describe("buildSkillTool", () => {
	it("lists the skills in its description and is named `skill`", () => {
		const tool = buildSkillTool(SKILLS, new Set());
		expect(tool.name).toBe(SKILL_TOOL_NAME);
		expect(tool.description).toContain("market-review: A股收盘复盘");
		expect(tool.description).toContain("deploy: Ship a release");
	});

	it("loading a skill returns its playbook and reveals its tools", async () => {
		const active = new Set<string>();
		const tool = buildSkillTool(SKILLS, active);
		const result = (await tool.execute?.(
			{ name: "market-review" },
			{} as never
		)) as {
			output: string;
			isError?: boolean;
		};
		expect(result.isError).toBeFalsy();
		expect(result.output).toContain("1. 定日期"); // the playbook body
		// Its tools are now active (callable on the next step).
		expect(active.has("finance_trade_calendar")).toBe(true);
		expect(active.has("finance_market_breadth")).toBe(true);
		// A different skill's tools were NOT revealed.
		expect(active.has("get_current_time")).toBe(false);
	});

	it("errors (without revealing anything) for an unknown skill name", async () => {
		const active = new Set<string>();
		const tool = buildSkillTool(SKILLS, active);
		const result = (await tool.execute?.({ name: "nope" }, {} as never)) as {
			output: string;
			isError?: boolean;
		};
		expect(result.isError).toBe(true);
		expect(result.output).toContain("market-review");
		expect(active.size).toBe(0);
	});
});
