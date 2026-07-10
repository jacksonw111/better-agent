import { expect, it } from "vitest";
import {
	buildComputerUseToolDefs,
	COMPUTER_USE_TOOLS,
} from "./computer-use-tools";
import { createInMemoryPendingToolCallStore } from "./pending-store";
import type { ToolContext } from "./types";

const TOOL_NAMES = [
	"observe",
	"click_element",
	"type_text",
	"scroll",
	"press_key",
];

function ctx(sessionId: string, callId: string): ToolContext {
	return {
		sessionId,
		callId,
		abortSignal: new AbortController().signal,
		agentId: "agent-1",
		messageId: "msg-1",
	};
}

it("exposes the 5 ax computer-use tools with object schemas", () => {
	expect(COMPUTER_USE_TOOLS.map((t) => t.name)).toEqual(TOOL_NAMES);
	for (const tool of COMPUTER_USE_TOOLS) {
		expect(tool.parameters).toMatchObject({ type: "object" });
		expect(tool.description.length).toBeGreaterThan(0);
	}
});

it("builds ToolDefs that park and resolve via the pending store", async () => {
	const store = createInMemoryPendingToolCallStore();
	const defs = buildComputerUseToolDefs(store);
	expect(defs.map((d) => d.name)).toEqual(TOOL_NAMES);

	const click = defs.find((d) => d.name === "click_element");
	if (!click) {
		throw new Error("missing click_element def");
	}
	const pending = click.execute({ index: 2 }, ctx("s1", "c1"));
	await store.resolve({
		sessionId: "s1",
		callId: "c1",
		result: { output: "clicked element 2", isError: false },
	});
	await expect(pending).resolves.toEqual({
		output: "clicked element 2",
		isError: false,
	});
});
