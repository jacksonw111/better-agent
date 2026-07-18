import { Badge } from "@better-agent/ui/components/badge";
import { Button } from "@better-agent/ui/components/button";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { cn } from "@better-agent/ui/lib/utils";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { GitBranchIcon } from "lucide-react";
import { CardNotice, ProjectCard, unavailableReason } from "./project-card";
import {
	type ProjectGitStatus,
	projectGitStatusOptions,
} from "./project-query";
import type { ProjectStatus } from "./project-status-chip";

// Q3: the project detail's Git card — one projects.query git_status on entry
// (branch, dirty/clean, changed files, last commit) plus a manual refresh.
// While the checkout can't be read (clone pending/failed, computer offline)
// the card explains itself instead of querying; a failed query (offline race,
// timeout) surfaces inline with a retry.

const SHORT_HASH_LENGTH = 7;

function DirtyBadge({ dirty }: { dirty: boolean }) {
	return (
		<Badge className="gap-1.5" variant="outline">
			<span
				aria-hidden
				className={cn(
					"size-1.5 rounded-full",
					dirty ? "bg-amber-500" : "bg-emerald-500"
				)}
			/>
			{dirty ? "Dirty" : "Clean"}
		</Badge>
	);
}

function ChangeList({ changes }: { changes: ProjectGitStatus["changes"] }) {
	if (changes.length === 0) {
		return <CardNotice text="No local changes." />;
	}
	return (
		<ul className="flex flex-col gap-1">
			{changes.map((change) => (
				<li className="flex items-center gap-2" key={change.path}>
					<code className="w-6 shrink-0 text-muted-foreground text-xs">
						{change.status}
					</code>
					<span className="truncate font-mono text-xs">{change.path}</span>
				</li>
			))}
		</ul>
	);
}

function GitStatusView({ git }: { git: ProjectGitStatus }) {
	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-wrap items-center gap-2">
				<GitBranchIcon className="size-4 text-muted-foreground" />
				<span className="font-medium text-sm">{git.branch}</span>
				<DirtyBadge dirty={git.dirty} />
			</div>
			<ChangeList changes={git.changes} />
			{git.lastCommit ? (
				<p className="truncate text-muted-foreground text-xs">
					<code>{git.lastCommit.hash.slice(0, SHORT_HASH_LENGTH)}</code>{" "}
					{git.lastCommit.subject}
				</p>
			) : (
				<CardNotice text="No commits yet." />
			)}
		</div>
	);
}

function GitCardBody({
	query,
	reason,
}: {
	query: UseQueryResult<ProjectGitStatus>;
	reason: string | null;
}) {
	if (reason !== null) {
		return <CardNotice text={reason} />;
	}
	if (query.isError) {
		return (
			<div className="flex flex-col items-start gap-2">
				<p className="text-destructive text-sm">{query.error.message}</p>
				<Button
					onClick={() => query.refetch()}
					size="sm"
					type="button"
					variant="outline"
				>
					Retry
				</Button>
			</div>
		);
	}
	if (query.isPending) {
		return <Skeleton className="h-20 w-full rounded-lg" />;
	}
	return <GitStatusView git={query.data} />;
}

export function ProjectGitCard({
	online,
	projectId,
	status,
}: {
	online: boolean;
	projectId: string;
	status: ProjectStatus;
}) {
	const reason = unavailableReason(status, online);
	const query = useQuery({
		...projectGitStatusOptions(projectId),
		enabled: reason === null,
		// The failure renders inline (with its retry) — no global error toast.
		meta: { silent: true },
		retry: false,
	});
	return (
		<ProjectCard
			onRefresh={reason === null ? () => query.refetch() : undefined}
			refreshing={query.isFetching}
			title="Git"
		>
			<GitCardBody query={query} reason={reason} />
		</ProjectCard>
	);
}
