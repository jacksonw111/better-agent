import { Button } from "@better-agent/ui/components/button";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { Link } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";
import { useState } from "react";
import type { BridgeSessionRow } from "@/utils/api-types";
import { localAgentDisplayName } from "./local-agent-format";
import type { LocalAgentEntry } from "./local-agent-join";
import { AGENT_KIND_LABEL, AgentKindIcon } from "./local-agent-kind-icon";
import { sessionTitle } from "./local-agent-session-picker";
import { LocalAgentSessionRow } from "./local-agent-session-row";
import { LocalAgentStatusChip } from "./local-agent-status-chip";

// P2-T2: the workspace's LEFT pane — this agent's identity plus its session
// list (newest first, one status signal per row) with "Load more" pagination.
// Local to the /local/$tokenId route; the global app sidebar is untouched.

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

/** The paged session list. Renames live in client state only for now — the
 * rename shell is the P2 deliverable, the rename route is P3. */
// P3: persist via rename route (bridge.renameSession) instead of this map.
function SessionList({
	activeSessionId,
	hasMore,
	isLoadingMore,
	onLoadMore,
	onSelectSession,
	sessions,
}: SidebarListProps) {
	const [renames, setRenames] = useState<Record<string, string>>({});
	if (sessions.length === 0) {
		return (
			<p className="px-3 py-2 text-muted-foreground text-xs">
				No sessions yet.
			</p>
		);
	}
	return (
		<div className="flex flex-col gap-0.5">
			{sessions.map((session) => (
				<LocalAgentSessionRow
					active={session.id === activeSessionId}
					displayLabel={renames[session.id] ?? sessionTitle(session)}
					key={session.id}
					onRename={(label) =>
						setRenames((previous) => ({ ...previous, [session.id]: label }))
					}
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
 * or the <md overlay drawer (the workspace decides which). */
export function LocalAgentWorkspaceSidebar({
	entry,
	...listProps
}: SidebarListProps & { entry: LocalAgentEntry }) {
	return (
		<nav
			aria-label="Sessions"
			className="flex min-h-0 flex-1 flex-col gap-3 pb-3"
		>
			<SidebarHeader entry={entry} />
			<div className="min-h-0 flex-1 overflow-y-auto px-2">
				<SessionList {...listProps} />
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
