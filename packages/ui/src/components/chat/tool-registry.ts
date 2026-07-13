import type { ReactNode } from "react";
import type { ToolInvocation } from "./chat-blocks";

// P1-T1: the ONE seam through which apps supply rich tool cards to the shared
// chat components. It replaces the old `renderTool` + `renderToolResult` prop
// pair: cloud wraps its genui result renderers (apps/web/src/genui/
// tool-renderers.tsx → `cloudToolRegistry`), local wraps its terminal-style
// ActivityItem cards (apps/web/src/components/bridge/bridge-tool-card.tsx →
// `bridgeToolRegistry`). A tool no entry claims falls back to the default
// `PlainToolView` (tool.tsx) exactly as before.

export interface ToolRegistryEntry {
	/** First matching entry in registration order wins. */
	match: (tool: ToolInvocation) => boolean;
	/** Returning null passes — the next entry (or the default card) gets it. */
	render: (tool: ToolInvocation) => ReactNode | null;
}

export type ToolRegistry = readonly ToolRegistryEntry[];

/** Walk the registry in order; the first matching entry whose `render`
 * produces a node wins. A matching entry may still return null to pass —
 * e.g. cloud's schema-validated genui cards decline a malformed result at
 * render time — in which case later entries (and ultimately the caller's
 * default card) get their turn. Returns null when nothing claims the tool. */
export function renderFromRegistry(
	registry: ToolRegistry | undefined,
	tool: ToolInvocation
): ReactNode | null {
	if (!registry) {
		return null;
	}
	for (const entry of registry) {
		if (!entry.match(tool)) {
			continue;
		}
		const node = entry.render(tool);
		if (node != null) {
			return node;
		}
	}
	return null;
}
