import { Badge } from "@better-agent/ui/components/badge";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@better-agent/ui/components/card";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { cn } from "@better-agent/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LaptopIcon } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/layout/empty-state";
import { DeleteConfirm } from "@/components/list/delete-confirm";
import type { ComputerListItem } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";
import { PairComputerDialog } from "./pair-computer-dialog";

/** Display names for the supported Agent Runtime kinds (spec §6.1). */
export const AGENT_LABELS = {
	"claude-code": "Claude Code",
	opencode: "OpenCode",
	codex: "Codex",
	pi: "Pi",
} as const;

/** Matches COMPUTER_HEARTBEAT_INTERVAL_MS: a freshly paired computer shows up
 * (and a stopped one goes Offline) within one poll of the server's view. */
const LIST_REFETCH_INTERVAL_MS = 10_000;

type RuntimeItem = ComputerListItem["runtimeInventory"][number];
type ToolItem = ComputerListItem["toolInventory"][number];

/** Connected/Offline pill, styled after LocalAgentStatusChip so the two
 * lists read the same. Offline computers stay listed — this only recolors. */
function ComputerStatusChip({ connected }: { connected: boolean }) {
	return (
		<Badge className="gap-1.5" variant={connected ? "outline" : "secondary"}>
			<span
				aria-hidden
				className={cn(
					"size-1.5 rounded-full",
					connected ? "bg-emerald-500" : "bg-muted-foreground/30"
				)}
			/>
			{connected ? "Connected" : "Offline"}
		</Badge>
	);
}

/** "Claude Code · 2 skills" for discoverable runtimes, bare label otherwise —
 * the skill count is part of the capability handshake, not decoration. */
function runtimeBadgeText(runtime: RuntimeItem): string {
	const label = AGENT_LABELS[runtime.agentKind];
	if (runtime.skillCapability !== "discoverable") {
		return label;
	}
	const count = runtime.skills.length;
	return `${label} · ${count} ${count === 1 ? "skill" : "skills"}`;
}

function RuntimeBadges({ runtimes }: { runtimes: RuntimeItem[] }) {
	if (runtimes.length === 0) {
		return (
			<p className="text-muted-foreground text-xs">
				No supported runtimes detected
			</p>
		);
	}
	return (
		<div className="flex flex-wrap gap-1.5">
			{runtimes.map((runtime) => (
				<Badge key={runtime.agentKind} variant="outline">
					{runtimeBadgeText(runtime)}
				</Badge>
			))}
		</div>
	);
}

/** git/gh presence facts. Deliberately quiet copy — "installed"/"missing" is
 * a PATH observation, never an authentication or health promise. */
function ToolFacts({ tools }: { tools: ToolItem[] }) {
	if (tools.length === 0) {
		return null;
	}
	return (
		<div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground text-xs">
			{tools.map((tool) => (
				<span className={cn(!tool.installed && "opacity-70")} key={tool.name}>
					{tool.name} {tool.installed ? "installed" : "missing"}
				</span>
			))}
		</div>
	);
}

function computerMeta(computer: ComputerListItem): string {
	const version =
		computer.clientVersion === null ? null : `Client ${computer.clientVersion}`;
	return [computer.platform, computer.arch, version]
		.filter((part) => part !== null)
		.join(" · ");
}

function ComputerCard({
	computer,
	onDelete,
}: {
	computer: ComputerListItem;
	onDelete: (id: string) => void;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle className="truncate">{computer.name}</CardTitle>
				<CardDescription>{computerMeta(computer)}</CardDescription>
				<CardAction className="flex items-center gap-1">
					<ComputerStatusChip connected={computer.connected} />
					<DeleteConfirm
						label={`Delete ${computer.name}? It disappears from this list until it is paired again.`}
						onConfirm={() => onDelete(computer.id)}
					/>
				</CardAction>
			</CardHeader>
			<CardContent className="flex flex-col gap-2.5">
				<RuntimeBadges runtimes={computer.runtimeInventory} />
				<ToolFacts tools={computer.toolInventory} />
			</CardContent>
		</Card>
	);
}

function useDeleteComputer() {
	const queryClient = useQueryClient();
	return useMutation(
		orpc.computers.delete.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: orpc.computers.list.key() });
			},
			onError: (error: Error) => toast.error(error.message),
		})
	);
}

function ComputersSkeleton() {
	return (
		<div className="flex flex-col gap-4">
			<div className="flex justify-end">
				<Skeleton className="h-8 w-44" />
			</div>
			<div className="grid gap-4 md:grid-cols-2">
				<Skeleton className="h-36 w-full rounded-xl" />
				<Skeleton className="h-36 w-full rounded-xl" />
			</div>
		</div>
	);
}

/**
 * The /computers list: every paired computer (Offline ones included) with its
 * live Connected state, runtime inventory + skill counts, and git/gh facts.
 * Polls every 10s so pairing and going offline surface without a refresh.
 */
export function ComputerList() {
	const query = useQuery({
		...orpc.computers.list.queryOptions(),
		refetchInterval: LIST_REFETCH_INTERVAL_MS,
	});
	const deleteComputer = useDeleteComputer();

	if (query.isPending) {
		return <ComputersSkeleton />;
	}

	const computers = query.data ?? [];
	if (computers.length === 0) {
		return (
			<EmptyState
				action={<PairComputerDialog />}
				body="Pair a computer to run agents on your own machine — Better Agent generates a one-time code and you run a single command."
				icon={LaptopIcon}
				title="No computers paired"
			/>
		);
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="flex justify-end">
				<PairComputerDialog />
			</div>
			<div className="grid gap-4 md:grid-cols-2">
				{computers.map((computer) => (
					<ComputerCard
						computer={computer}
						key={computer.id}
						onDelete={(id) => deleteComputer.mutate({ id })}
					/>
				))}
			</div>
		</div>
	);
}
