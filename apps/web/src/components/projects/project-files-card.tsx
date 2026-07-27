import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { ChevronRightIcon, FileIcon, FolderIcon } from "lucide-react";
import { Fragment, useState } from "react";
import {
	CardNotice,
	ProjectCard,
	QueryErrorNotice,
	unavailableReason,
} from "./project-card";
import { type ProjectFsEntry, projectFsListOptions } from "./project-query";
import type { ProjectStatus } from "./project-status-chip";

// Q3: the project detail's Files card — a READ-ONLY browse of the checkout
// via projects.query fs_list. Clicking a directory drills in (one query per
// directory, cached by path); the breadcrumb climbs back out. While the
// checkout can't be read the card explains itself instead of querying.

const BYTES_PER_KB = 1024;

/** "2.0 KB"-style size for files; directories carry none. */
export function formatSize(size: number | undefined): string | null {
	if (size === undefined) {
		return null;
	}
	if (size < BYTES_PER_KB) {
		return `${size} B`;
	}
	return `${(size / BYTES_PER_KB).toFixed(1)} KB`;
}

/** Directories first, then files, each group alphabetical. */
export function sortedEntries(entries: ProjectFsEntry[]): ProjectFsEntry[] {
	return [...entries].sort((a, b) => {
		if (a.kind !== b.kind) {
			return a.kind === "dir" ? -1 : 1;
		}
		return a.name.localeCompare(b.name);
	});
}

export function Breadcrumbs({
	onNavigate,
	path,
}: {
	onNavigate: (path: string) => void;
	path: string;
}) {
	const segments = path === "" ? [] : path.split("/");
	return (
		<nav
			aria-label="Path"
			className="flex flex-wrap items-center gap-1 text-xs"
		>
			<button
				className="text-muted-foreground transition-colors hover:text-foreground"
				onClick={() => onNavigate("")}
				type="button"
			>
				root
			</button>
			{segments.map((segment, index) => {
				const target = segments.slice(0, index + 1).join("/");
				return (
					<Fragment key={target}>
						<span aria-hidden className="text-muted-foreground">
							/
						</span>
						<button
							className="text-muted-foreground transition-colors hover:text-foreground"
							onClick={() => onNavigate(target)}
							type="button"
						>
							{segment}
						</button>
					</Fragment>
				);
			})}
		</nav>
	);
}

function EntryRow({
	entry,
	onOpenDir,
}: {
	entry: ProjectFsEntry;
	onOpenDir: () => void;
}) {
	if (entry.kind === "dir") {
		return (
			<button
				className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted/60"
				data-name={entry.name}
				data-testid="fs-entry"
				onClick={onOpenDir}
				type="button"
			>
				<FolderIcon className="size-4 shrink-0 text-muted-foreground" />
				<span className="min-w-0 flex-1 truncate text-sm">{entry.name}</span>
				<ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
			</button>
		);
	}
	return (
		<div
			className="flex items-center gap-2 rounded-lg px-2 py-1.5"
			data-name={entry.name}
			data-testid="fs-entry"
		>
			<FileIcon className="size-4 shrink-0 text-muted-foreground" />
			<span className="min-w-0 flex-1 truncate text-sm">{entry.name}</span>
			<span className="shrink-0 text-muted-foreground text-xs">
				{formatSize(entry.size)}
			</span>
		</div>
	);
}

export function FilesCardBody({
	entries,
	error,
	onOpenDir,
	onRetry,
	path,
	pending,
}: {
	entries: ProjectFsEntry[] | undefined;
	error: Error | null;
	onOpenDir: (name: string) => void;
	onRetry: () => void;
	path: string;
	pending: boolean;
}) {
	if (error) {
		return <QueryErrorNotice error={error} onRetry={onRetry} />;
	}
	if (pending || !entries) {
		return <Skeleton className="h-24 w-full rounded-lg" />;
	}
	if (entries.length === 0) {
		return <CardNotice text="This directory is empty." />;
	}
	return (
		<div className="flex flex-col gap-0.5">
			{sortedEntries(entries).map((entry) => (
				<EntryRow
					entry={entry}
					key={entry.name}
					onOpenDir={() =>
						onOpenDir(path === "" ? entry.name : `${path}/${entry.name}`)
					}
				/>
			))}
		</div>
	);
}

export function ProjectFilesCard({
	online,
	projectId,
	status,
}: {
	online: boolean;
	projectId: string;
	status: ProjectStatus;
}) {
	const [path, setPath] = useState("");
	const reason = unavailableReason(status, online);
	const query = useQuery({
		...projectFsListOptions(projectId, path),
		enabled: reason === null,
		meta: { silent: true },
		retry: false,
	});
	return (
		<ProjectCard
			onRefresh={reason === null ? () => query.refetch() : undefined}
			refreshing={query.isFetching}
			title="Files"
		>
			{reason === null ? (
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
			) : (
				<CardNotice text={reason} />
			)}
		</ProjectCard>
	);
}
