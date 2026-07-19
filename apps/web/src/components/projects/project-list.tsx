import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRightIcon, FolderGit2Icon } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/layout/empty-state";
import { DeleteConfirm } from "@/components/list/delete-confirm";
import type { ProjectListItem } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";
import { isClonePending, ProjectStatusChip } from "./project-status-chip";

// Q3: the Computer detail page's Projects block — one row per project (name,
// repo, clone-status chip, the REAL error message on a failed clone), the
// whole row linking into the project detail page (tint + radius, no borders,
// same treatment as the agent rows). The Link is a stretched overlay so the
// row's Delete action stays its own click target (same pattern as the
// computer cards). While any clone is still queued/running the list polls
// every 5s so created→cloning→ready/error plays out live.

export const PROJECT_POLL_INTERVAL_MS = 5000;

/** The popover-confirm copy shared by the list rows and the detail header —
 * the delete removes the server-side record ONLY; the checkout directory on
 * the computer is the user's local data. */
export function deleteProjectLabel(name: string): string {
	return `Delete ${name}? The local checkout directory on this computer is not deleted.`;
}

/** 5s while any clone is pending, otherwise no poll at all. */
export function projectsPollInterval(
	projects: Pick<ProjectListItem, "status">[] | undefined
): number | false {
	const pending = (projects ?? []).some((project) =>
		isClonePending(project.status)
	);
	return pending ? PROJECT_POLL_INTERVAL_MS : false;
}

function ProjectRow({
	onDelete,
	project,
}: {
	onDelete: (id: string) => void;
	project: ProjectListItem;
}) {
	return (
		<div className="relative flex items-center gap-3 rounded-xl bg-muted/40 px-4 py-3.5 transition-colors hover:bg-muted/70">
			<Link
				aria-label={`Open ${project.name}`}
				className="absolute inset-0 rounded-xl focus-visible:ring-2 focus-visible:ring-ring/50"
				params={{ computerId: project.computerId, projectId: project.id }}
				to="/computers/$computerId/projects/$projectId"
			/>
			<FolderGit2Icon className="size-5 shrink-0 text-muted-foreground" />
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="truncate font-medium text-sm">{project.name}</span>
				<span className="truncate text-muted-foreground text-xs">
					{project.repoFullName}
				</span>
				{project.status === "error" && (
					<span className="truncate text-destructive text-xs">
						{project.errorMessage ?? "Clone failed"}
					</span>
				)}
			</span>
			<ProjectStatusChip status={project.status} />
			<span className="relative flex items-center">
				<DeleteConfirm
					label={deleteProjectLabel(project.name)}
					onConfirm={() => onDelete(project.id)}
				/>
			</span>
			<ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
		</div>
	);
}

/** projects.delete from a list row — refresh the list, surface real errors. */
function useDeleteProjectRow() {
	const queryClient = useQueryClient();
	return useMutation(
		orpc.projects.delete.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: orpc.projects.list.key() });
			},
			onError: (error: Error) => toast.error(error.message),
		})
	);
}

export function ProjectListSkeleton() {
	return (
		<div className="flex flex-col gap-2">
			<Skeleton className="h-14 w-full rounded-xl" />
			<Skeleton className="h-14 w-full rounded-xl" />
		</div>
	);
}

/** The computer's projects, one row per checkout. An empty list explains the
 * concept instead of a blank. */
export function ComputerProjectList({ computerId }: { computerId: string }) {
	const query = useQuery({
		...orpc.projects.list.queryOptions({ input: { computerId } }),
		refetchInterval: (state) => projectsPollInterval(state.state.data),
	});
	const deleteProject = useDeleteProjectRow();
	const projects = query.data;
	if (!projects) {
		return <ProjectListSkeleton />;
	}
	if (projects.length === 0) {
		return (
			<EmptyState
				body="Clone a git repository onto this computer once, then start every session against the same long-lived checkout."
				icon={FolderGit2Icon}
				title="No projects yet"
			/>
		);
	}
	return (
		<div className="flex flex-col gap-2">
			{projects.map((project) => (
				<ProjectRow
					key={project.id}
					onDelete={(id) => deleteProject.mutate({ projectId: id })}
					project={project}
				/>
			))}
		</div>
	);
}
