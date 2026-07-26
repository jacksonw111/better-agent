import { CopyAction } from "@better-agent/ui/components/actions";
import { Button } from "@better-agent/ui/components/button";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";
import { ComputerStatusChip } from "@/components/computers/computer-status-chip";
import { DeleteConfirm } from "@/components/list/delete-confirm";
import { PtySessionList } from "@/components/pty/pty-session-list";
import type { ComputerListItem, ProjectListItem } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";
import { EditProjectDialog } from "./edit-project-dialog";
import { ProjectFilesCard } from "./project-files-card";
import { ProjectGitCard } from "./project-git-card";
import { deleteProjectLabel, projectsPollInterval } from "./project-list";
import { ProjectStartWork } from "./project-start-work";
import { ProjectStatusChip } from "./project-status-chip";

// Q3: the /computers/$computerId/projects/$projectId body. One compact header
// row carries the checkout's identity (name, repo, clone-status chip — with a
// Retry beside a failed one — and the copyable local path once ready) with
// the Edit/Delete actions on its right. Below it the MAIN action first: the
// Start work block that opens sessions inside the checkout, then the Git and
// Files cards side by side as the live view into it. projects.get polls on
// the same 5s cadence as the list while a clone is pending.

/** Matches COMPUTER_HEARTBEAT_INTERVAL_MS — the online gate stays fresh. */
const COMPUTERS_REFETCH_INTERVAL_MS = 10_000;

function ProjectDetailSkeleton() {
	return (
		<div className="flex flex-col gap-6">
			<div className="flex items-center gap-3">
				<Skeleton className="h-6 w-48" />
				<Skeleton className="h-4 w-64" />
			</div>
			<div className="grid gap-4 md:grid-cols-2">
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

/** projects.retryClone for a FAILED clone: error → created re-enters the
 * delivery queue and the page's poll follows the fresh attempt. Disabled
 * while the computer is offline — the server would refuse the re-queue. */
function RetryCloneButton({
	online,
	projectId,
}: {
	online: boolean;
	projectId: string;
}) {
	const queryClient = useQueryClient();
	const retry = useMutation(
		orpc.projects.retryClone.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: orpc.projects.get.key() });
				queryClient.invalidateQueries({ queryKey: orpc.projects.list.key() });
				toast.success("Clone restarted");
			},
			onError: (error: Error) => toast.error(error.message),
		})
	);
	return (
		<Button
			disabled={!online || retry.isPending}
			onClick={() => retry.mutate({ projectId })}
			size="xs"
			type="button"
			variant="outline"
		>
			<RefreshCwIcon
				className={retry.isPending ? "size-3.5 animate-spin" : "size-3.5"}
			/>
			Retry
		</Button>
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

/** One compact row: identity facts left, Edit/Delete right; the error line
 * (a full sentence) gets its own row underneath. */
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
		<header className="flex flex-col gap-2">
			<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
				<h1 className="truncate font-semibold text-lg">{project.name}</h1>
				<span className="truncate text-muted-foreground text-sm">
					{project.repoFullName}
				</span>
				<ProjectStatusChip status={project.status} />
				{project.status === "error" && (
					<RetryCloneButton online={online} projectId={project.id} />
				)}
				{!online && <ComputerStatusChip connected={false} />}
				{project.status === "ready" && project.localPath && (
					<LocalPath path={project.localPath} />
				)}
				<div className="ml-auto flex items-center gap-1">
					<EditProjectDialog project={project} />
					<DeleteConfirm
						label={deleteProjectLabel(project.name)}
						onConfirm={onDelete}
					/>
				</div>
			</div>
			{project.status === "error" && (
				<p className="break-words text-destructive text-sm">
					{project.errorMessage ?? "Clone failed"}
				</p>
			)}
		</header>
	);
}

/** The Git + Files cards — the live view into the checkout, both behind the
 * same online/status gate, side by side from md up. */
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
		<div className="grid gap-4 md:grid-cols-2">
			<ProjectGitCard online={online} projectId={projectId} status={status} />
			<ProjectFilesCard online={online} projectId={projectId} status={status} />
		</div>
	);
}

/** The loaded body: header, the one-click Terminal sessions list, the chat
 * Start work block, then the Git/Files cards. */
function ProjectBody({
	computer,
	onDelete,
	online,
	project,
}: {
	computer: ComputerListItem | undefined;
	onDelete: () => void;
	online: boolean;
	project: ProjectListItem;
}) {
	return (
		<div className="flex flex-col gap-6">
			<ProjectHeader onDelete={onDelete} online={online} project={project} />
			<PtySessionList
				computerId={project.computerId}
				online={online && project.status === "ready"}
				projectId={project.id}
				runtimes={(computer?.runtimeInventory ?? []).map(
					(runtime) => runtime.agentKind
				)}
			/>
			<ProjectStartWork computer={computer} online={online} project={project} />
			<ProjectCards
				online={online}
				projectId={project.id}
				status={project.status}
			/>
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
	return (
		<ProjectBody
			computer={computer}
			onDelete={() => deleteProject.mutate({ projectId })}
			online={computer?.connected ?? false}
			project={project}
		/>
	);
}
