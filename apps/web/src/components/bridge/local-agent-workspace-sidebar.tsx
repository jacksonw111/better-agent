import { Button } from "@better-agent/ui/components/button";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { Link } from "@tanstack/react-router";
import { ArchiveIcon, ArrowLeftIcon } from "lucide-react";
import { useState } from "react";
import type { BridgeSessionRow } from "@/utils/api-types";
import { ArchivedSessionList } from "./local-agent-archived-list";
import { localAgentDisplayName } from "./local-agent-format";
import type { LocalAgentEntry } from "./local-agent-join";
import { AGENT_KIND_LABEL, AgentKindIcon } from "./local-agent-kind-icon";
import {
	nextSessionAfterRemoval,
	type SessionActions,
	sortStarredFirst,
	useSessionActions,
} from "./local-agent-session-actions";
import { LocalAgentSessionRow } from "./local-agent-session-row";
import { LocalAgentStatusChip } from "./local-agent-status-chip";

// P2-T2: the workspace's LEFT pane — this agent's identity plus its session
// list (starred pinned first, then newest first) with "Load more" pagination.
// P3-T1 wires rename/star/archive/delete to the persisted session-mgmt routes
// and adds the bottom toggle into the archived view. Local to the
// /local/$tokenId route; the global app sidebar is untouched.

/** Agent identity block + the way back to the /local list. */
function SidebarHeader({ entry }: { entry: LocalAgentEntry }) {
	const { token } = entry;
	return (
		<div className="flex shrink-0 flex-col gap-3 px-3 pt-3">
			<Link
				className="flex w-fit items-center gap-1 text-muted-foreground text-xs transition-colors hover:text-foreground"
				to="/local"
			>
				<ArrowLeftIcon aria-hidden className="size-3.5" />
				Local agents
			</Link>
			<div className="flex items-center gap-2">
				<AgentKindIcon
					className="size-4 shrink-0 text-muted-foreground"
					kind={token.agentKind}
				/>
				<div className="flex min-w-0 flex-1 flex-col">
					<span className="truncate font-medium text-sm">
						{localAgentDisplayName(entry)}
					</span>
					<span className="truncate text-muted-foreground text-xs">
						{AGENT_KIND_LABEL[token.agentKind]}
					</span>
				</div>
				<LocalAgentStatusChip status={entry.status} />
			</div>
		</div>
	);
}

/** One list row: LocalAgentSessionRow with its mutations wired — split out of
 * `SessionList` to keep it under the max-lines-per-function gate. */
function SessionListRow({
	actions,
	active,
	onSelect,
	session,
}: {
	actions: SessionActions;
	active: boolean;
	onSelect: () => void;
	session: BridgeSessionRow;
}) {
	return (
		<LocalAgentSessionRow
			active={active}
			onArchive={() => actions.archive.mutate({ sessionId: session.id })}
			onDelete={() => actions.deleteSession.mutate({ sessionId: session.id })}
			onRename={(name) =>
				actions.rename.mutate({ sessionId: session.id, name })
			}
			onSelect={onSelect}
			onToggleStar={() =>
				actions.star.mutate({
					sessionId: session.id,
					starred: !session.starred,
				})
			}
			session={session}
		/>
	);
}

/** The paged session list, starred rows pinned to the top. Rename/star/
 * archive/delete persist via the session-mgmt mutations; archiving or
 * deleting the ACTIVE session moves selection to the newest remaining one. */
function SessionList({
	activeSessionId,
	hasMore,
	isLoadingMore,
	onLoadMore,
	onSelectSession,
	sessions,
}: SidebarListProps) {
	const actions = useSessionActions((removedId) => {
		const next = nextSessionAfterRemoval(sessions, activeSessionId, removedId);
		if (next) {
			onSelectSession(next);
		}
	});
	if (sessions.length === 0) {
		return (
			<p className="px-3 py-2 text-muted-foreground text-xs">
				No sessions yet.
			</p>
		);
	}
	return (
		<div className="flex flex-col gap-0.5">
			{sortStarredFirst(sessions).map((session) => (
				<SessionListRow
					actions={actions}
					active={session.id === activeSessionId}
					key={session.id}
					onSelect={() => onSelectSession(session.id)}
					session={session}
				/>
			))}
			{hasMore && (
				<Button
					className="mt-1 self-start text-muted-foreground"
					disabled={isLoadingMore}
					onClick={onLoadMore}
					size="sm"
					variant="ghost"
				>
					{isLoadingMore ? "Loading…" : "Load more"}
				</Button>
			)}
		</div>
	);
}

interface SidebarListProps {
	activeSessionId: string | null;
	hasMore: boolean;
	isLoadingMore: boolean;
	onLoadMore: () => void;
	onSelectSession: (sessionId: string) => void;
	sessions: BridgeSessionRow[];
}

/** The full sidebar column — rendered once, mounted either in the md+ aside
 * or the <md overlay drawer (the workspace decides which). The bottom toggle
 * swaps the main list for the archived view (P3-T1). */
export function LocalAgentWorkspaceSidebar({
	entry,
	...listProps
}: SidebarListProps & { entry: LocalAgentEntry }) {
	const [showArchived, setShowArchived] = useState(false);
	return (
		<nav
			aria-label="Sessions"
			className="flex min-h-0 flex-1 flex-col gap-3 pb-2"
		>
			<SidebarHeader entry={entry} />
			<div className="min-h-0 flex-1 overflow-y-auto px-2">
				{showArchived ? (
					<ArchivedSessionList tokenId={entry.token.id} />
				) : (
					<SessionList {...listProps} />
				)}
			</div>
			<div className="shrink-0 px-2">
				<Button
					className="w-full justify-start text-muted-foreground"
					onClick={() => setShowArchived((previous) => !previous)}
					size="sm"
					variant="ghost"
				>
					{showArchived ? (
						<ArrowLeftIcon className="size-3.5" />
					) : (
						<ArchiveIcon className="size-3.5" />
					)}
					{showArchived ? "Back to sessions" : "Archived"}
				</Button>
			</div>
		</nav>
	);
}

const SKELETON_ROW_KEYS = ["r1", "r2", "r3", "r4", "r5"];

/** Skeleton rows shown while the first sessions page loads. */
export function WorkspaceSidebarSkeleton() {
	return (
		<div className="flex flex-col gap-3 px-3 pt-3">
			<Skeleton className="h-3 w-20" />
			<Skeleton className="h-8 w-full" />
			<div className="flex flex-col gap-2 pt-2">
				{SKELETON_ROW_KEYS.map((key) => (
					<Skeleton className="h-8 w-full" key={key} />
				))}
			</div>
		</div>
	);
}
