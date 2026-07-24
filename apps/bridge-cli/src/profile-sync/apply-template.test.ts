import { expect, it } from "vitest";
import { applyTemplate } from "./apply-template";
import type { BundleMcpServer, BundleTemplate } from "./bundle";
import { createFakeFs } from "./fake-fs";

function template(over: Partial<BundleTemplate> = {}): BundleTemplate {
	return {
		claudeMd: null,
		description: null,
		id: "t1",
		mcpServerIds: [],
		name: "Node",
		scaffold: { dirs: [], files: [] },
		...over,
	};
}

const TARGET = "/work/proj";

it("creates scaffold dirs and writes seed files", async () => {
	const fs = createFakeFs();
	await applyTemplate({
		fs,
		mcpServers: [],
		serverUrl: "https://api.test",
		targetDir: TARGET,
		template: template({
			scaffold: {
				dirs: ["src", "test"],
				files: [{ content: "print", path: "src/main.ts" }],
			},
		}),
	});
	expect(fs.get("/work/proj/src/main.ts")).toBe("print");
});

it("writes the project-layer CLAUDE.md increment", async () => {
	const fs = createFakeFs();
	await applyTemplate({
		fs,
		mcpServers: [],
		serverUrl: "https://api.test",
		targetDir: TARGET,
		template: template({ claudeMd: "Use pnpm." }),
	});
	expect(fs.get("/work/proj/CLAUDE.md")).toBe("Use pnpm.");
});

it("writes a project .mcp.json with the template's servers + project memory", async () => {
	const fs = createFakeFs();
	const server: BundleMcpServer = {
		headers: {},
		id: "m1",
		name: "weather",
		url: "https://w.test",
	};
	await applyTemplate({
		bridgeToken: "bt_x",
		fs,
		mcpServers: [server],
		projectId: "proj-1",
		serverUrl: "https://api.test",
		targetDir: TARGET,
		template: template({ mcpServerIds: ["m1", "missing"] }),
	});
	const json = JSON.parse(fs.get("/work/proj/.mcp.json") ?? "{}");
	expect(json.mcpServers.weather.url).toBe("https://w.test");
	expect(json.mcpServers.memory.headers["x-better-agent-project-id"]).toBe(
		"proj-1"
	);
});
