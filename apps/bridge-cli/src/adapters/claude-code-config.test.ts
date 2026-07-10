import { expect, it, vi } from "vitest";
import { claudeCodeAdapter } from "./claude-code";
import { mockQuery } from "./claude-code-test-harness";

// Phase 4: the claude-code adapter applies the bridge token's persisted
// startup config (appendSystemPrompt + maxTurns) at query() time. Split out
// of claude-code.test.ts to keep that file under the 300-line limit.

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
	query: vi.fn(),
	listSessions: vi.fn(),
}));

it("applies startup config: appends to the system prompt and caps maxTurns", async () => {
	const { harness } = mockQuery();
	await claudeCodeAdapter.start("/tmp/project", {
		config: { appendSystemPrompt: "Always cite the file.", maxTurns: 12 },
	});

	expect(harness.options).toMatchObject({
		maxTurns: 12,
		systemPrompt: {
			append: "Always cite the file.",
			preset: "claude_code",
			type: "preset",
		},
	});
});

it("applies effort + maxBudgetUsd from the persisted config", async () => {
	const { harness } = mockQuery();
	await claudeCodeAdapter.start("/tmp/project", {
		config: { effort: "xhigh", maxBudgetUsd: 2.5 },
	});

	expect(harness.options).toMatchObject({ effort: "xhigh", maxBudgetUsd: 2.5 });
});

it("omits systemPrompt when no appendSystemPrompt is configured", async () => {
	const { harness } = mockQuery();
	await claudeCodeAdapter.start("/tmp/project", { config: { maxTurns: 5 } });

	expect(harness.options?.systemPrompt).toBeUndefined();
	expect(harness.options).toMatchObject({ maxTurns: 5 });
});

it("applies model + permissionMode from the persisted config", async () => {
	const { harness } = mockQuery();
	await claudeCodeAdapter.start("/tmp/project", {
		config: { model: "claude-opus-4-8", permissionMode: "plan" },
	});

	expect(harness.options).toMatchObject({
		model: "claude-opus-4-8",
		permissionMode: "plan",
	});
});

it("omits permissionMode when the configured value isn't a recognized SDK mode", async () => {
	const { harness } = mockQuery();
	await claudeCodeAdapter.start("/tmp/project", {
		config: { permissionMode: "not-a-real-mode" },
	});

	expect(harness.options?.permissionMode).toBeUndefined();
});

// R5-b: resolved MCP servers are applied at start as the SDK `mcpServers`
// option — a name→config record of HTTP transports carrying decrypted headers.
it("applies resolved MCP servers at start as name→http-config records", async () => {
	const { harness } = mockQuery();
	await claudeCodeAdapter.start("/tmp/project", {
		mcpServers: [
			{
				name: "weread",
				url: "https://mcp.example/weread",
				headers: { Authorization: "Bearer tok" },
			},
		],
	});

	expect(harness.options?.mcpServers).toEqual({
		weread: {
			type: "http",
			url: "https://mcp.example/weread",
			headers: { Authorization: "Bearer tok" },
		},
	});
});

it("passes an empty mcpServers record when none are configured", async () => {
	const { harness } = mockQuery();
	await claudeCodeAdapter.start("/tmp/project", { config: { maxTurns: 5 } });

	expect(harness.options?.mcpServers).toEqual({});
});

// R5-b LIVE: setMcpServers replaces the session's servers with no restart,
// mapping the resolved servers through the same name→http-config shape.
it("setMcpServers applies servers LIVE via the SDK query", async () => {
	const { harness } = mockQuery();
	const handle = await claudeCodeAdapter.start("/tmp/project");

	handle.setMcpServers?.([
		{
			name: "finance",
			url: "https://mcp.example/finance",
			headers: { Authorization: "Bearer fin" },
		},
	]);

	expect(harness.setMcpServers).toHaveBeenCalledWith({
		finance: {
			type: "http",
			url: "https://mcp.example/finance",
			headers: { Authorization: "Bearer fin" },
		},
	});
});
