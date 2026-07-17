import { Skeleton } from "@better-agent/ui/components/skeleton";
import { Link } from "@tanstack/react-router";
import { ChevronRightIcon, MonitorIcon } from "lucide-react";
import { AgentKindIcon } from "@/components/bridge/local-agent-kind-icon";
import { AGENT_LABELS } from "@/components/computers/agent-labels";
import { EmptyState } from "@/components/layout/empty-state";
import type { ComputerListItem } from "@/utils/api-types";

// P3: the Computer detail page's main content — the machine's agent runtime
// inventory (Claude Code / OpenCode / Codex / Pi as reported by the client),
// each row linking into that agent's session list. This replaced the task
// cards: the product surface is agent -> sessions, not a task list.

type RuntimeItem = ComputerListItem["runtimeInventory"][number];

/** "2 skills · discoverable" — the runtime's skill facts, or nothing. */
function skillFacts(runtime: RuntimeItem): string | null {
	if (runtime.skills.length === 0) {
		return null;
	}
	const count = runtime.skills.length;
	return `${count} ${count === 1 ? "skill" : "skills"}`;
}

/** One agent runtime row — the whole row links into the agent's session list
 * (no borders: tint + radius, matching the session-row treatment). */
function AgentRow({
	computerId,
	runtime,
}: {
	computerId: string;
	runtime: RuntimeItem;
}) {
	const facts = skillFacts(runtime);
	return (
		<Link
			className="flex items-center gap-3 rounded-xl bg-muted/40 px-4 py-3.5 transition-colors hover:bg-muted/70"
			params={{ agentKind: runtime.agentKind, computerId }}
			to="/computers/$computerId/agents/$agentKind"
		>
			<AgentKindIcon
				className="size-5 shrink-0 text-muted-foreground"
				kind={runtime.agentKind}
			/>
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="truncate font-medium text-sm">
					{AGENT_LABELS[runtime.agentKind]}
				</span>
				{facts && (
					<span className="truncate text-muted-foreground text-xs">
						{facts}
					</span>
				)}
			</span>
			<ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
		</Link>
	);
}

export function AgentListSkeleton() {
	return (
		<div className="flex flex-col gap-2">
			<Skeleton className="h-14 w-full rounded-xl" />
			<Skeleton className="h-14 w-full rounded-xl" />
		</div>
	);
}

/** The computer's reported agent runtimes, one row per runtime. An empty
 * inventory (a client that reported none) explains itself instead of a blank. */
export function ComputerAgentList({
	computer,
}: {
	computer: ComputerListItem;
}) {
	if (computer.runtimeInventory.length === 0) {
		return (
			<EmptyState
				body="This computer's client reported no installed agent runtimes. Install one (Claude Code, OpenCode, Codex or Pi) and re-pair or restart the client."
				icon={MonitorIcon}
				title="No agents on this computer"
			/>
		);
	}
	return (
		<div className="flex flex-col gap-2">
			{computer.runtimeInventory.map((runtime) => (
				<AgentRow
					computerId={computer.id}
					key={runtime.agentKind}
					runtime={runtime}
				/>
			))}
		</div>
	);
}
