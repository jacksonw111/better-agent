import { Button } from "@better-agent/ui/components/button";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { AGENT_LABELS } from "@/components/computers/agent-labels";
import { computerMeta, ToolFacts } from "@/components/computers/computer-facts";
import { ComputerStatusChip } from "@/components/computers/computer-status-chip";
import { NewTaskDialog } from "@/components/tasks/new-task-dialog";
import type { ComputerListItem } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";

/** Matches COMPUTER_HEARTBEAT_INTERVAL_MS — Connected/Offline and the
 * runtime inventory stay fresh while the page is open, same as the list. */
const LIST_REFETCH_INTERVAL_MS = 10_000;

type RuntimeItem = ComputerListItem["runtimeInventory"][number];

/** Discoverable runtimes carry their skill count; capability "none" says so
 * instead of pretending zero skills were found. */
function skillCapabilityText(runtime: RuntimeItem): string {
	if (runtime.skillCapability !== "discoverable") {
		return "Skills not discoverable";
	}
	const count = runtime.skills.length;
	return `${count} ${count === 1 ? "skill" : "skills"}`;
}

function AgentInventory({ runtimes }: { runtimes: RuntimeItem[] }) {
	return (
		<section className="flex flex-col gap-2">
			<h2 className="font-medium text-sm">Installed agents</h2>
			{runtimes.length === 0 ? (
				<p className="rounded-lg bg-muted/40 px-4 py-3 text-muted-foreground text-sm">
					No supported runtimes detected on this computer.
				</p>
			) : (
				<ul className="flex flex-col gap-1.5">
					{runtimes.map((runtime) => (
						<li
							className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-4 py-3"
							key={runtime.agentKind}
						>
							<span className="font-medium text-sm">
								{AGENT_LABELS[runtime.agentKind]}
							</span>
							<span className="text-muted-foreground text-xs">
								{skillCapabilityText(runtime)}
							</span>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

function ComputerDetailSkeleton() {
	return (
		<div className="flex flex-col gap-6">
			<div className="flex items-start justify-between gap-3">
				<div className="flex flex-col gap-2">
					<Skeleton className="h-6 w-48" />
					<Skeleton className="h-4 w-64" />
				</div>
				<Skeleton className="h-8 w-28" />
			</div>
			<div className="flex flex-col gap-1.5">
				<Skeleton className="h-11 w-full rounded-lg" />
				<Skeleton className="h-11 w-full rounded-lg" />
			</div>
		</div>
	);
}

function NotFound() {
	return (
		<p className="rounded-lg bg-muted/40 p-6 text-center text-muted-foreground text-sm">
			This computer wasn't found — it may have been deleted, or the link is
			wrong.
		</p>
	);
}

/**
 * The /computers/$computerId body: the machine's read-only facts (name,
 * Connected/Offline, platform/arch/client version, git/gh), its installed
 * agent runtimes with skill counts, and a New Task button that opens the
 * wizard with this computer pre-selected (still changeable in Step 1).
 * Reads from the same computers.list query the list page uses — no extra API.
 */
export function ComputerDetail({ computerId }: { computerId: string }) {
	const query = useQuery({
		...orpc.computers.list.queryOptions(),
		refetchInterval: LIST_REFETCH_INTERVAL_MS,
	});
	const [newTaskOpen, setNewTaskOpen] = useState(false);

	if (query.isPending) {
		return <ComputerDetailSkeleton />;
	}

	const computer = (query.data ?? []).find((item) => item.id === computerId);
	if (!computer) {
		return <NotFound />;
	}

	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="flex min-w-0 flex-col gap-1.5">
					<div className="flex items-center gap-2">
						<h1 className="truncate font-semibold text-lg">{computer.name}</h1>
						<ComputerStatusChip connected={computer.connected} />
					</div>
					<p className="text-muted-foreground text-sm">
						{computerMeta(computer)}
					</p>
					<ToolFacts tools={computer.toolInventory} />
				</div>
				<Button onClick={() => setNewTaskOpen(true)} size="sm" type="button">
					<PlusIcon />
					New Task
				</Button>
			</div>
			<AgentInventory runtimes={computer.runtimeInventory} />
			<NewTaskDialog
				defaultComputerId={computer.id}
				onOpenChange={setNewTaskOpen}
				open={newTaskOpen}
			/>
		</div>
	);
}
