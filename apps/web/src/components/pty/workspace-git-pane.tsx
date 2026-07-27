import { Skeleton } from "@better-agent/ui/components/skeleton";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { QueryErrorNotice } from "../projects/project-card";
import { GitStatusView } from "../projects/project-git-card";
import type { ProjectGitStatus } from "../projects/project-query";
import { WorkspacePaneShell } from "./workspace-pane-shell";
import { workspaceGitStatusOptions } from "./workspace-query";

// DP-WS: the terminal page's Git pane — one pty.query git_status on the
// session's workspace (branch, dirty/clean, changed files, last commit) plus a
// manual refresh. Reuses the project Git card's GitStatusView presentation
// verbatim; only the query source differs.

function GitPaneBody({ query }: { query: UseQueryResult<ProjectGitStatus> }) {
	if (query.isError) {
		return (
			<QueryErrorNotice error={query.error} onRetry={() => query.refetch()} />
		);
	}
	if (query.isPending) {
		return <Skeleton className="h-20 w-full rounded-lg" />;
	}
	return <GitStatusView git={query.data} />;
}

export function WorkspaceGitPane({ sessionId }: { sessionId: string }) {
	const query = useQuery({
		...workspaceGitStatusOptions(sessionId),
		meta: { silent: true },
		retry: false,
	});
	return (
		<WorkspacePaneShell
			onRefresh={() => query.refetch()}
			refreshing={query.isFetching}
			sessionId={sessionId}
			title="Git"
		>
			<GitPaneBody query={query} />
		</WorkspacePaneShell>
	);
}
