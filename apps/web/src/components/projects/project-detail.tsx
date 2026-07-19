import { CopyAction } from "@better-agent/ui/components/actions";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { ComputerStatusChip } from "@/components/computers/computer-status-chip";
import { DeleteConfirm } from "@/components/list/delete-confirm";
import type { ProjectListItem } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";
import { ProjectFilesCard } from "./project-files-card";
import { ProjectGitCard } from "./project-git-card";
import { deleteProjectLabel, projectsPollInterval } from "./project-list";
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

/** projects.delete from the detail page: success toasts, refreshes the list
 * and navigates back to the computer the project lived on. */
function useDeleteProject(computerId: string) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	return useMutation(
		orpc.projects.delete.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: orpc.projects.list.key() });
				toast.success("Project deleted");
				navigate({ params: { computerId }, to: "/computers/$computerId" });
			},
			onError: (error: Error) => toast.error(error.message),
		})
	);
}

function ProjectHeader({
	onDelete,
	online,
	project,
}: {
	onDelete: () => void;
	online: boolean;
	project: ProjectListItem;
}) {
	return (
		<div className="flex items-start justify-between gap-3">
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
			<DeleteConfirm
				label={deleteProjectLabel(project.name)}
				onConfirm={onDelete}
			/>
		</div>
	);
}

/** The Git + Files cards — the live view into the checkout, both behind the
 * same online/status gate. */
function ProjectCards({
	online,
	projectId,
	status,
}: {
	online: boolean;
	projectId: string;
	status: ProjectListItem["status"];
}) {
	return (
		<div className="grid gap-4 lg:grid-cols-2">
			<ProjectGitCard online={online} projectId={projectId} status={status} />
			<ProjectFilesCard online={online} projectId={projectId} status={status} />
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
	const deleteProject = useDeleteProject(computerId);
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
			<ProjectHeader
				onDelete={() => deleteProject.mutate({ projectId })}
				online={online}
				project={project}
			/>
			<ProjectCards
				online={online}
				projectId={projectId}
				status={project.status}
			/>
			<ProjectStartWork computer={computer} online={online} project={project} />
		</div>
	);
}
