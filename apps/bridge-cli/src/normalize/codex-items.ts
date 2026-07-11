// R1-T2: two codex `item/*` shapes `codex.ts`'s `normalizeCodexItem` used to
// silently drop — split out purely to keep codex.ts under the repo's
// 300-line file cap.

import { asString, NO_EVENTS, type NormalizedEvent } from "./types";

/** ASSUMPTION (unverified, no `codex` binary in this sandbox): a `reasoning`
 * item's completed text lives at `item.text`, mirroring `agentMessage`'s own
 * extraction (see `normalizeCodexAgentMessageItem` in codex.ts). Same
 * materialize-once contract: the caller only invokes this on the terminal
 * `item/completed` — `item/started` and any streaming delta stay
 * display-only, same as agentMessage (8e2d980). Mapped to an `output` event
 * with `reasoning: true`, styled like every other adapter's thinking text. */
export function normalizeCodexReasoningItem(
	item: Record<string, unknown>
): NormalizedEvent[] {
	const text = asString(item.text);
	return text === undefined
		? NO_EVENTS
		: [{ kind: "output", reasoning: true, text }];
}

/** ASSUMPTION (unverified, no `codex` binary in this sandbox): an
 * `mcpToolCall`/`dynamicToolCall` item's tool name lives at `item.tool`
 * (falling back to `item.name`), arguments at `item.arguments` (falling back
 * to `item.input`), and the result at `item.output` (falling back to
 * `item.result`) — none of these field names are confirmed against a real
 * binary, so every one is extracted defensively: an unrecognized shape
 * degrades to a generic "mcp"-named tool card instead of being dropped.
 * Unlike agentMessage/fileChange, this is NOT gated to the terminal
 * notification — like `commandExecution`, it's driven by the item's own
 * `status` field so the same tool bubble can update in place across
 * `item/started` → `item/completed` (the dedup-by-id itself happens
 * downstream, in the web's fold). */
export function normalizeCodexMcpToolCallItem(
	item: Record<string, unknown>
): NormalizedEvent[] {
	const id = asString(item.id);
	if (id === undefined) {
		return NO_EVENTS;
	}
	const name = asString(item.tool) ?? asString(item.name) ?? "mcp";
	return [
		{
			id,
			input: item.arguments ?? item.input,
			kind: "tool",
			name,
			output: item.output ?? item.result,
			status: item.status === "completed" ? "completed" : "started",
		},
	];
}
