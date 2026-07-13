import { expect, it } from "vitest";
import type { ToolInvocation } from "./chat-blocks";
import { renderFromRegistry, type ToolRegistry } from "./tool-registry";

function tool(partial: Partial<ToolInvocation>): ToolInvocation {
	return {
		args: {},
		callId: "c1",
		isError: false,
		status: "complete",
		toolName: "get_weather",
		...partial,
	};
}

it("returns null for an undefined registry", () => {
	expect(renderFromRegistry(undefined, tool({}))).toBeNull();
});

it("returns null for an empty registry", () => {
	expect(renderFromRegistry([], tool({}))).toBeNull();
});

it("the first matching entry wins, in registration order", () => {
	const registry: ToolRegistry = [
		{ match: (t) => t.toolName === "get_weather", render: () => "first" },
		{ match: () => true, render: () => "second" },
	];
	expect(renderFromRegistry(registry, tool({}))).toBe("first");
});

it("a non-matching entry is skipped without calling its render", () => {
	let rendered = false;
	const registry: ToolRegistry = [
		{
			match: () => false,
			render: () => {
				rendered = true;
				return "never";
			},
		},
		{ match: () => true, render: () => "hit" },
	];
	expect(renderFromRegistry(registry, tool({}))).toBe("hit");
	expect(rendered).toBe(false);
});

it("a matching entry whose render returns null falls through to the next", () => {
	const registry: ToolRegistry = [
		{ match: () => true, render: () => null },
		{ match: () => true, render: () => "fallback entry" },
	];
	expect(renderFromRegistry(registry, tool({}))).toBe("fallback entry");
});

it("returns null when every matching entry declines", () => {
	const registry: ToolRegistry = [
		{ match: () => true, render: () => null },
		{ match: (t) => t.toolName === "other_tool", render: () => "unreached" },
	];
	expect(renderFromRegistry(registry, tool({}))).toBeNull();
});

it("passes the tool through to both match and render", () => {
	const seen: string[] = [];
	const registry: ToolRegistry = [
		{
			match: (t) => {
				seen.push(`match:${t.toolName}`);
				return true;
			},
			render: (t) => {
				seen.push(`render:${t.callId}`);
				return "ok";
			},
		},
	];
	expect(renderFromRegistry(registry, tool({}))).toBe("ok");
	expect(seen).toEqual(["match:get_weather", "render:c1"]);
});
