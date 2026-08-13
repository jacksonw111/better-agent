// @vitest-environment jsdom
import { fireEvent, render, within } from "@testing-library/react";
import { expect, it } from "vitest";
import type { ToolInvocation } from "./chat-blocks";
import { ToolGroup } from "./tool";
import type { ToolRegistry } from "./tool-registry";

const PRETTY_PRINTED_ARGS = /"city": "berlin"/;

function baseTool(overrides: Partial<ToolInvocation>): ToolInvocation {
	return {
		args: { city: "berlin" },
		callId: "call-1",
		isError: false,
		result: undefined,
		status: "complete",
		toolName: "get_weather",
		...overrides,
	};
}

// Queries are scoped to each render's `container` (via `within`) rather than
// the global `screen`: this repo's vitest config doesn't enable test globals,
// so @testing-library/react never auto-registers its afterEach(cleanup) and
// DOM from earlier tests in this file would otherwise still be attached.
function renderTools(tools: ToolInvocation[], toolRegistry?: ToolRegistry) {
	const { container } = render(
		<ToolGroup toolRegistry={toolRegistry} tools={tools} />
	);
	return { container, scope: within(container) };
}

it("a complete tool renders a closed collapsible with the tool name", () => {
	const tool = baseTool({ result: "sunny, mild" });
	const { scope } = renderTools([tool]);
	expect(scope.getByText("get_weather")).toBeDefined();
	// Successful calls default closed: no sections until the user expands.
	expect(scope.queryByText("Arguments")).toBeNull();
	expect(scope.queryByText("Result")).toBeNull();
});

it("expanding a complete tool reveals Arguments and Result with formatted values", () => {
	const tool = baseTool({ result: "sunny, mild" });
	const { scope } = renderTools([tool]);
	fireEvent.click(scope.getByRole("button"));
	expect(scope.getByText("Arguments")).toBeDefined();
	// Object args are pretty-printed JSON in the section body.
	expect(scope.getByText(PRETTY_PRINTED_ARGS)).toBeDefined();
	expect(scope.getByText("Result")).toBeDefined();
	expect(scope.getByText("sunny, mild")).toBeDefined();
});

it("an errored tool defaults open with the error text and destructive tint", () => {
	const tool = baseTool({
		isError: true,
		result: "boom: tool failed",
		status: "error",
	});
	const { container, scope } = renderTools([tool]);
	// No click needed: defaultOpen shows the banner and the raw sections.
	expect(scope.getAllByText("boom: tool failed").length).toBeGreaterThan(0);
	expect(scope.getByText("Arguments")).toBeDefined();
	// Borderless: the error state is a destructive TEXT tint on the rail-indented
	// paragraph — never a colored card border or ring.
	expect(container.querySelector('[class*="text-destructive"]')).not.toBe(null);
});

it("a running tool renders no Result section", () => {
	const tool = baseTool({ status: "running" });
	const { scope } = renderTools([tool]);
	fireEvent.click(scope.getByRole("button"));
	expect(scope.getByText("Arguments")).toBeDefined();
	expect(scope.queryByText("Result")).toBeNull();
});

it("a claiming registry entry replaces the plain block entirely", () => {
	const tool = baseTool({ result: { temperature: "21C" } });
	const registry: ToolRegistry = [
		{ match: () => true, render: () => <p>rich weather view</p> },
	];
	const { scope } = renderTools([tool], registry);
	expect(scope.getByText("rich weather view")).toBeDefined();
	// The raw disclosure (wrench + name + button) must not render alongside it.
	expect(scope.queryByText("get_weather")).toBeNull();
	expect(scope.queryByRole("button")).toBeNull();
});

it("a registry entry that declines (render → null) keeps the plain block", () => {
	const tool = baseTool({ result: "sunny, mild" });
	const registry: ToolRegistry = [{ match: () => true, render: () => null }];
	const { scope } = renderTools([tool], registry);
	expect(scope.getByText("get_weather")).toBeDefined();
});
