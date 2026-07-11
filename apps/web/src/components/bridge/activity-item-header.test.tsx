// @vitest-environment jsdom
import type { ToolInvocation } from "@better-agent/ui/components/chat/chat-blocks";
import { render, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { primaryLine, ToolCardHeader } from "./activity-item-header";

// Reviewer finding 4 (minor): `tool.title` is written by adapters (see
// bridge-turns-tool-task.ts) but never read anywhere on the header — when a
// category's extraction yields no text, fall back to it before toolName.
// Queries are scoped to each render's own `container` (mirroring
// activity-group.test.tsx) since this vitest config doesn't enable
// `globals: true`, so testing-library's auto-cleanup-between-tests never
// registers and unscoped queries would see every prior test's DOM.

function tool(partial: Partial<ToolInvocation> = {}): ToolInvocation {
	return {
		args: {},
		callId: "c1",
		isError: false,
		status: "complete",
		toolName: "Bash",
		...partial,
	};
}

it("falls back to tool.title when the category extraction yields no text", () => {
	const call = tool({ args: {}, title: "Restart dev server" });
	const line = primaryLine("command", call);
	expect(line.text).toBe("");

	const { container } = render(
		<ToolCardHeader
			diffLines={null}
			hasBody={false}
			line={line}
			onToggle={() => {
				// no-op
			}}
			open={false}
			tool={call}
		/>
	);
	const scope = within(container);
	expect(scope.getByText("Restart dev server")).toBeDefined();
	expect(scope.queryByText("Bash")).toBeNull();
});

it("falls back to toolName when neither the extraction nor tool.title is present", () => {
	const call = tool({ args: {} });
	const line = primaryLine("command", call);

	const { container } = render(
		<ToolCardHeader
			diffLines={null}
			hasBody={false}
			line={line}
			onToggle={() => {
				// no-op
			}}
			open={false}
			tool={call}
		/>
	);
	expect(within(container).getByText("Bash")).toBeDefined();
});

it("prefers extracted text over tool.title when both are present", () => {
	const call = tool({
		args: { command: "npm run dev" },
		title: "Ignored title",
	});
	const line = primaryLine("command", call);

	const { container } = render(
		<ToolCardHeader
			diffLines={null}
			hasBody={false}
			line={line}
			onToggle={() => {
				// no-op
			}}
			open={false}
			tool={call}
		/>
	);
	const scope = within(container);
	expect(scope.getByText("npm run dev")).toBeDefined();
	expect(scope.queryByText("Ignored title")).toBeNull();
});
