import type { ToolInvocation } from "@better-agent/ui/components/chat/chat-blocks";
import type { StreamEvent } from "./bridge-events";
import { applyToolResult } from "./bridge-turns-tool-task";

// P4-T2: folds the terminal feed's out-of-band `runShell` tool events into one
// `ToolInvocation` per command (id-keyed), in first-appearance order — the
// Shell pane renders each as the existing `BashCommandCard`. Reuses
// `applyToolResult` (the same started→completed/failed merge the chat feed's
// fold uses) so a running command's preview/duration/output settle identically.

/** Whether `entry` is one of the Shell tab's own out-of-band tool events. */
export function isShellEvent(entry: StreamEvent): boolean {
	return entry.event.kind === "tool" && entry.event.source === "runShell";
}

export function foldShellEvents(events: StreamEvent[]): ToolInvocation[] {
	const byId = new Map<string, ToolInvocation>();
	const ordered: ToolInvocation[] = [];
	for (const { event } of events) {
		if (event.kind !== "tool" || event.source !== "runShell") {
			continue;
		}
		let tool = byId.get(event.id);
		if (!tool) {
			tool = {
				args: event.input,
				callId: event.id,
				isError: false,
				status: "running",
				toolName: event.name,
			};
			byId.set(event.id, tool);
			ordered.push(tool);
		}
		applyToolResult(tool, event);
	}
	return ordered;
}
