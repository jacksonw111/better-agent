import type { PendingToolCallStore } from "./pending-store";
import { buildRemoteToolDefs, type RemoteToolDef } from "./remote-tools";
import type { JsonSchema, ToolDef } from "./types";

// ax-mode computer-use tools. The cloud agent perceives the screen as a
// structured accessibility tree (text) and acts by element index — no
// screenshots, so every result is a plain string that the existing park/resolve
// remote-tool path handles unchanged. Execution happens on the local VM: the
// bridge CLI resolves each parked call via `sessions.submitToolResult`.

const NO_ARGS: JsonSchema = {
	type: "object",
	properties: {},
	additionalProperties: false,
};

const CLICK_ELEMENT_PARAMS: JsonSchema = {
	type: "object",
	properties: {
		index: {
			type: "integer",
			description: "element index from the latest observe() tree",
		},
	},
	required: ["index"],
	additionalProperties: false,
};

const TYPE_TEXT_PARAMS: JsonSchema = {
	type: "object",
	properties: { text: { type: "string" } },
	required: ["text"],
	additionalProperties: false,
};

const SCROLL_PARAMS: JsonSchema = {
	type: "object",
	properties: {
		direction: { type: "string", enum: ["up", "down", "left", "right"] },
		amount: { type: "integer", description: "scroll steps", default: 3 },
	},
	required: ["direction"],
	additionalProperties: false,
};

const PRESS_KEY_PARAMS: JsonSchema = {
	type: "object",
	properties: {
		combo: {
			type: "string",
			description: "a key or combination, e.g. 'Enter' or 'cmd+c'",
		},
	},
	required: ["combo"],
	additionalProperties: false,
};

export const COMPUTER_USE_TOOLS: RemoteToolDef[] = [
	{
		name: "observe",
		description:
			"Read the current screen as a structured accessibility tree (a text outline of actionable UI elements, each tagged with an element index). Call this to see what is on screen before acting.",
		parameters: NO_ARGS,
	},
	{
		name: "click_element",
		description:
			"Click a UI element by its index from the latest observe() accessibility tree.",
		parameters: CLICK_ELEMENT_PARAMS,
	},
	{
		name: "type_text",
		description: "Type text into the currently focused field.",
		parameters: TYPE_TEXT_PARAMS,
	},
	{
		name: "scroll",
		description: "Scroll the screen in a direction.",
		parameters: SCROLL_PARAMS,
	},
	{
		name: "press_key",
		description:
			"Press a key or key combination (e.g. 'Enter', 'cmd+c') on the VM.",
		parameters: PRESS_KEY_PARAMS,
	},
];

/** Build the ax computer-use ToolDefs. Each parks on the pending store keyed by
 * the turn's sessionId+callId; the local bridge CLI executes it on the VM and
 * resolves it via submitToolResult. Text results only (no screenshots). */
export function buildComputerUseToolDefs(
	store: PendingToolCallStore
): ToolDef[] {
	return buildRemoteToolDefs(COMPUTER_USE_TOOLS, store);
}
