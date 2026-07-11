import { Collapsible } from "@base-ui/react/collapsible";
import type { ToolInvocation } from "@better-agent/ui/components/chat/chat-blocks";
import { ChevronRightIcon } from "lucide-react";
import { renderActivityTool } from "./bridge-tool-card";

// R1-T3: a run of more than 5 consecutive tool blocks in one turn (see
// activity-blocks.ts's `groupTurnBlocks`) collapses to this single
// disclosure row instead of a wall of ActivityItem cards — only reachable
// once the run is complete (a still-running run stays expanded upstream).

export function ActivityGroup({ tools }: { tools: ToolInvocation[] }) {
	return (
		<Collapsible.Root className="flex flex-col gap-1.5">
			<Collapsible.Trigger className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-muted-foreground text-xs hover:text-foreground">
				<ChevronRightIcon className="size-3.5 shrink-0 transition-transform data-[panel-open]:rotate-90" />
				<span>执行了 {tools.length} 个操作</span>
			</Collapsible.Trigger>
			<Collapsible.Panel className="flex flex-col gap-1.5">
				{tools.map((tool) => (
					<div key={tool.callId}>{renderActivityTool(tool)}</div>
				))}
			</Collapsible.Panel>
		</Collapsible.Root>
	);
}
