import { CopyAction } from "@better-agent/ui/components/actions";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { ComputerStatusChip } from "@/components/computers/computer-status-chip";
import type { ProjectListItem } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";
import { ProjectFilesCard } from "./project-files-card";
import { ProjectGitCard } from "./project-git-card";
import { projectsPollInterval } from "./project-list";
import { ProjectStartWork } from "./project-start-work";
import { ProjectStatusChip } from "./project-status-chip";

// Q3: the /computers/$computerId/projects/$projectId body — the checkout's
// identity (name, repo, clone status, local path once ready) as the header,
// the Git and Files cards as the live view into the checkout, and the Start
// work block that opens sessions inside it. projects.get polls on the same
// 5s cadence as the list while the clone is still pending.

/** Matches COMPUTER_HEARTBEAT_INTERVAL_MS — the online gate stays fresh. */
const COMPUTERS_REFETCH_INTERVAL_MS = 10_000;

function ProjectDetailSkeleton() {
	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-col gap-2">
				<Skeleton className="h-6 w-48" />
				<Skeleton className="h-4 w-64" />
			</div>
			<div className="grid gap-4 lg:grid-cols-2">
				<Skeleton className="h-40 w-full rounded-xl" />
				<Skeleton className="h-40 w-full rounded-xl" />
			</div>
		</div>
	);
}

function NotFound() {
	return (
		<p className="rounded-lg bg-muted/40 p-6 text-center text-muted-foreground text-sm">
			This project wasn't found — it may have been deleted, or the link is
			wrong.
		</p>
	);
}

function LocalPath({ path }: { path: string }) {
	return (
		<div className="flex max-w-full items-center gap-1.5">
			<code className="block overflow-x-auto whitespace-nowrap rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs">
				{path}
			</code>
			<CopyAction label="Copy path" text={path} />
		</div>
	);
}

function ProjectHeader({
	online,
	project,
}: {
	online: boolean;
	project: ProjectListItem;
}) {
	return (
		<div className="flex min-w-0 flex-col gap-1.5">
			<div className="flex flex-wrap items-center gap-2">
				<h1 className="truncate font-semibold text-lg">{project.name}</h1>
				<ProjectStatusChip status={project.status} />
				{!online && <ComputerStatusChip connected={false} />}
			</div>
			<p className="truncate text-muted-foreground text-sm">
				{project.repoFullName}
			</p>
			{project.status === "error" && (
				<p className="break-words text-destructive text-sm">
					{project.errorMessage ?? "Clone failed"}
				</p>
			)}
			{project.status === "ready" && project.localPath && (
				<LocalPath path={project.localPath} />
			)}
		</div>
	);
}

export function ProjectDetail({
	computerId,
	projectId,
}: {
	computerId: string;
	projectId: string;
}) {
	const projectQuery = useQuery({
		...orpc.projects.get.queryOptions({ input: { projectId } }),
		refetchInterval: (state) =>
			projectsPollInterval(state.state.data ? [state.state.data] : undefined),
		retry: false,
	});
	const computersQuery = useQuery({
		...orpc.computers.list.queryOptions(),
		refetchInterval: COMPUTERS_REFETCH_INTERVAL_MS,
	});
	if (projectQuery.isPending) {
		return <ProjectDetailSkeleton />;
	}
	const project = projectQuery.data;
	if (!project) {
		return <NotFound />;
	}
	const computer = (computersQuery.data ?? []).find(
		(item) => item.id === computerId
	);
	const online = computer?.connected ?? false;
	return (
		<div className="flex flex-col gap-6">
			<ProjectHeader online={online} project={project} />
			<div className="grid gap-4 lg:grid-cols-2">
				<ProjectGitCard
					online={online}
					projectId={projectId}
					status={project.status}
				/>
				<ProjectFilesCard
					online={online}
					projectId={projectId}
					status={project.status}
				/>
			</div>
			<ProjectStartWork computer={computer} online={online} project={project} />
		</div>
	);
}
