import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Breadcrumbs, FilesCardBody } from "../projects/project-files-card";
import { WorkspacePaneShell } from "./workspace-pane-shell";
import { workspaceFsListOptions } from "./workspace-query";

// DP-WS: the terminal page's Files pane — a READ-ONLY browse of the session's
// workspace via pty.query fs_list. Reuses the project Files card's presentation
// verbatim (Breadcrumbs + FilesCardBody); only the query source (session vs
// project) differs. Clicking a directory drills in (one query per directory,
// cached by path); the breadcrumb climbs back out.

export function WorkspaceFilesPane({ sessionId }: { sessionId: string }) {
	const [path, setPath] = useState("");
	const query = useQuery({
		...workspaceFsListOptions(sessionId, path),
		meta: { silent: true },
		retry: false,
	});
	return (
		<WorkspacePaneShell
			onRefresh={() => query.refetch()}
			refreshing={query.isFetching}
			sessionId={sessionId}
			title="Files"
		>
			<div className="flex flex-col gap-2">
				<Breadcrumbs onNavigate={setPath} path={path} />
				<FilesCardBody
					entries={query.data?.entries}
					error={query.error}
					onOpenDir={setPath}
					onRetry={() => query.refetch()}
					path={path}
					pending={query.isPending}
				/>
			</div>
		</WorkspacePaneShell>
	);
}
