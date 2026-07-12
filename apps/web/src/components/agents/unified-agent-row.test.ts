import { describe, expect, it } from "vitest";
import {
	matchUnifiedRow,
	mergeUnifiedRows,
	rowCreatedAt,
	rowId,
	rowName,
	rowSubtitle,
	type UnifiedAgentRow,
} from "./unified-agent-row";

// Build minimal fakes via `as` casts — only the fields the helpers touch.
const cloudAgent = {
	createdAt: new Date("2026-07-02"),
	id: "a1",
	modelId: "claude-sonnet-5",
	name: "Researcher",
	providerId: "anthropic",
} as never;
const localEntry = {
	latestSession: null,
	status: "not-connected",
	token: {
		agentKind: "claude-code",
		createdAt: new Date("2026-07-05"),
		id: "t1",
		name: "Laptop",
	},
} as never;

describe("unified-agent-row", () => {
	it("exposes id/name/subtitle/createdAt per type", () => {
		const cloud: UnifiedAgentRow = { agent: cloudAgent, type: "cloud" };
		const local: UnifiedAgentRow = {
			entry: localEntry,
			sessionCount: 2,
			type: "local",
		};
		expect(rowId(cloud)).toBe("a1");
		expect(rowId(local)).toBe("t1");
		expect(rowName(cloud)).toBe("Researcher");
		expect(rowName(local)).toBe("Laptop");
		expect(rowSubtitle(cloud)).toBe("anthropic/claude-sonnet-5");
		expect(rowSubtitle(local)).toBe("Claude Code");
		expect(rowCreatedAt(local).getTime()).toBeGreaterThan(
			rowCreatedAt(cloud).getTime()
		);
	});

	it("merges sorted by createdAt desc and counts sessions", () => {
		const rows = mergeUnifiedRows(
			[cloudAgent],
			[localEntry],
			new Map([["t1", 2]])
		);
		expect(rows.map((r) => rowId(r))).toEqual(["t1", "a1"]);
		const local = rows[0];
		expect(local.type === "local" && local.sessionCount).toBe(2);
	});

	it("matches on name, subtitle, and type label", () => {
		const cloud: UnifiedAgentRow = { agent: cloudAgent, type: "cloud" };
		expect(matchUnifiedRow(cloud, "research")).toBe(true);
		expect(matchUnifiedRow(cloud, "anthropic")).toBe(true);
		expect(matchUnifiedRow(cloud, "cloud")).toBe(true);
		expect(matchUnifiedRow(cloud, "local")).toBe(false);
	});
});
