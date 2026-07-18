import { Badge } from "@better-agent/ui/components/badge";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { cn } from "@better-agent/ui/lib/utils";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { GitBranchIcon } from "lucide-react";
import {
	CardNotice,
	ProjectCard,
	QueryErrorNotice,
	unavailableReason,
} from "./project-card";
import {
	type ProjectGitStatus,
	projectGitStatusOptions,
} from "./project-query";
import type { ProjectStatus } from "./project-status-chip";

// Q3: the project detail's Git card — one projects.query git_status on entry
// (branch, dirty/clean, changed files, last commit) plus a manual refresh.
// While the checkout can't be read (clone pending/failed, computer offline)
// the card explains itself instead of querying; a failed query surfaces per
// the Q2 taxonomy (QueryErrorNotice). A null branch is a detached HEAD, and
// each change's raw porcelain XY pair renders as a tinted friendly label.

const SHORT_HASH_LENGTH = 7;

type ChangeKind =
	| "added"
	| "conflicted"
	| "deleted"
	| "modified"
	| "renamed"
	| "unknown"
	| "untracked";

// Both-sides pairs that mean a merge conflict even without a `U` char.
const CONFLICT_PAIRS = new Set(["AA", "DD"]);

/** Maps a raw porcelain v1 XY pair (" M", "??", "A ", …) to a friendly
 * label. The index (X) char wins when set, else the worktree (Y) one — so
 * "AM" reads added, " M" modified. Unknown codes pass through verbatim. */
export function describeChangeStatus(status: string): {
	kind: ChangeKind;
	label: string;
} {
	if (status === "??") {
		return { kind: "untracked", label: "untracked" };
	}
	if (CONFLICT_PAIRS.has(status) || status.includes("U")) {
		return { kind: "conflicted", label: "conflicted" };
	}
	const significant = status.startsWith(" ") ? status[1] : status[0];
	switch (significant) {
		case "A":
			return { kind: "added", label: "added" };
		case "D":
			return { kind: "deleted", label: "deleted" };
		case "M":
		case "T":
			return { kind: "modified", label: "modified" };
		case "R":
			return { kind: "renamed", label: "renamed" };
		default:
			return { kind: "unknown", label: status };
	}
}

// Tinted (no-border) label styles: added green, modified yellow, deleted
// red, untracked/unknown gray — conflicted and renamed get their own hues.
const CHANGE_KIND_CLASSES: Record<ChangeKind, string> = {
	added: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
	conflicted: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
	deleted: "bg-red-500/10 text-red-600 dark:text-red-400",
	modified: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
	renamed: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
	unknown: "bg-muted text-muted-foreground",
	untracked: "bg-muted text-muted-foreground",
};

function ChangeStatusLabel({ status }: { status: string }) {
	const { kind, label } = describeChangeStatus(status);
	return (
		<span
			className={cn(
				"shrink-0 rounded px-1.5 py-0.5 font-medium text-[10px] leading-4",
				CHANGE_KIND_CLASSES[kind]
			)}
			title={status}
		>
			{label}
		</span>
	);
}

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
					<ChangeStatusLabel status={change.status} />
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
				{git.branch === null ? (
					<span className="font-medium text-muted-foreground text-sm italic">
						detached HEAD
					</span>
				) : (
					<span className="font-medium text-sm">{git.branch}</span>
				)}
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
			<QueryErrorNotice error={query.error} onRetry={() => query.refetch()} />
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
