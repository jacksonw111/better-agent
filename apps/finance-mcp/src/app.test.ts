import { describe, expect, it } from "vitest";
import { buildApp } from "./app";

describe("finance-mcp app", () => {
	it("responds to health check", async () => {
		const app = buildApp();
		const res = await app.request("/");
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("better-agent-finance-mcp OK");
	});
});
