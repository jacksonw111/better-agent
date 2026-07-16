import { describe, expect, it } from "vitest";
import {
	matchAgentRow,
	rowCreatedAt,
	rowSubtitle,
	sortAgentRows,
} from "./unified-agent-row";

// Build minimal fakes via `as` casts — only the fields the helpers touch.
const researcher = {
	createdAt: new Date("2026-07-02"),
	id: "a1",
	modelId: "claude-sonnet-5",
	name: "Researcher",
	providerId: "anthropic",
} as never;
const writer = {
	createdAt: new Date("2026-07-05"),
	id: "a2",
	modelId: "gpt-6",
	name: "Writer",
	providerId: "openai",
} as never;

describe("unified-agent-row", () => {
	it("exposes subtitle and createdAt", () => {
		const row = { agent: researcher };
		expect(rowSubtitle(row)).toBe("anthropic/claude-sonnet-5");
		expect(rowCreatedAt(row).toISOString()).toContain("2026-07-02");
	});

	it("sorts rows by createdAt desc", () => {
		const rows = sortAgentRows([researcher, writer]);
		expect(rows.map((row) => row.agent.id)).toEqual(["a2", "a1"]);
	});

	it("matches on name and subtitle", () => {
		const row = { agent: researcher };
		expect(matchAgentRow(row, "research")).toBe(true);
		expect(matchAgentRow(row, "anthropic")).toBe(true);
		expect(matchAgentRow(row, "gpt")).toBe(false);
	});
});
