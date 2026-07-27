import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { FolderIcon } from "lucide-react";
import { orpc } from "@/utils/orpc";
import { CardNotice, ProjectCard } from "../projects/project-card";

// DP-WS: the shared shell for the terminal page's Files/Git/Shell panes — the
// project cards' tinted section (ProjectCard) plus the one gate all three share:
// resolve the session's workspace (pty.workspace) first, show its path, and only
// mount the pane's live query when the workspace can actually be read (ready
// project / active session). A non-ready/ended workspace explains itself instead
// of firing a doomed query — the same contract as the project cards' cards.

/** The workspace path line every pane shows: the checkout dir for a project
 * session, or "Home directory" for a project-less one. */
function WorkspacePathLabel({
	kind,
	path,
}: {
	kind: "home" | "project";
	path: string | null;
}) {
	const label =
		kind === "home" ? "Home directory" : (path ?? "Project checkout");
	return (
		<p className="flex items-center gap-1.5 truncate text-muted-foreground text-xs">
			<FolderIcon className="size-3.5 shrink-0" />
			<span className="truncate font-mono">{label}</span>
		</p>
	);
}

/**
 * Wraps a pane's body with the workspace path + availability gate. `children`
 * receives nothing and is rendered ONLY when the workspace is available, so a
 * pane's queries never fire against an unreadable workspace. `onRefresh` wires
 * the card's refresh affordance to the pane's own query.
 */
export function WorkspacePaneShell({
	children,
	onRefresh,
	refreshing,
	sessionId,
	title,
}: {
	children: React.ReactNode;
	onRefresh?: () => void;
	refreshing?: boolean;
	sessionId: string;
	title: string;
}) {
	const info = useQuery(
		orpc.pty.workspace.queryOptions({ input: { sessionId } })
	);
	const available = info.data?.reason == null;
	return (
		<ProjectCard
			onRefresh={available ? onRefresh : undefined}
			refreshing={refreshing}
			title={title}
		>
			<div className="flex min-w-0 flex-col gap-3">
				{info.isPending ? (
					<Skeleton className="h-4 w-40 rounded" />
				) : (
					info.data && (
						<WorkspacePathLabel kind={info.data.kind} path={info.data.path} />
					)
				)}
				{info.data?.reason != null && <CardNotice text={info.data.reason} />}
				{available && children}
			</div>
		</ProjectCard>
	);
}
