import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import {
	AgentListSkeleton,
	ComputerAgentList,
} from "@/components/computers/computer-agent-list";
import { computerMeta, ToolFacts } from "@/components/computers/computer-facts";
import { ComputerStatusChip } from "@/components/computers/computer-status-chip";
import { NewProjectDialog } from "@/components/projects/new-project-dialog";
import { ComputerProjectList } from "@/components/projects/project-list";
import { orpc } from "@/utils/orpc";

/** Matches COMPUTER_HEARTBEAT_INTERVAL_MS — Connected/Offline stays fresh
 * while the page is open. */
const LIST_REFETCH_INTERVAL_MS = 10_000;

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
			<AgentListSkeleton />
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
 * Connected/Offline, platform/arch/client version, git/gh) as the header,
 * then the machine's AGENT RUNTIME list as the main content — each agent
 * links into its session list (/computers/$computerId/agents/$agentKind),
 * where sessions are started and reopened. P3: the task cards and the New
 * Task wizard entry left this page; sessions replaced tasks as the product
 * surface.
 */
export function ComputerDetail({ computerId }: { computerId: string }) {
	const query = useQuery({
		...orpc.computers.list.queryOptions(),
		refetchInterval: LIST_REFETCH_INTERVAL_MS,
	});

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
			</div>
			<section className="flex flex-col gap-2">
				<h2 className="font-medium text-sm">Agents</h2>
				<ComputerAgentList computer={computer} />
			</section>
			<section className="flex flex-col gap-2">
				<div className="flex items-center justify-between gap-2">
					<h2 className="font-medium text-sm">Projects</h2>
					<NewProjectDialog computerId={computer.id} />
				</div>
				<ComputerProjectList computerId={computer.id} />
			</section>
		</div>
	);
}
