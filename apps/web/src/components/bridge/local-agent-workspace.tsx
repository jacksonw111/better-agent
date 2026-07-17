import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { BridgeSessionRow } from "@/utils/api-types";
import { userAvatar } from "@/utils/avatar";
import { orpc } from "@/utils/orpc";
import { useCurrentUser } from "@/utils/use-current-user";
import {
	LocalAgentNotFound,
	SessionView,
	WaitingForCli,
} from "./local-agent-detail";
import { LocalAgentDetailSkeleton } from "./local-agent-detail-skeleton";
import {
	deriveLocalAgentEntries,
	type LocalAgentEntry,
} from "./local-agent-join";
import { sortSessionsByRecency } from "./local-agent-session-picker";
import { WorkspaceCommandBridge } from "./local-agent-workspace-command-bridge";
import {
	pickActiveSession,
	useWorkspaceSessions,
} from "./local-agent-workspace-sessions";
import {
	LocalAgentWorkspaceSidebar,
	WorkspaceSidebarSkeleton,
} from "./local-agent-workspace-sidebar";
import { SessionWorkspacePane } from "./session-workspace-pane";
import {
	MobileSidebarDrawer,
	SidebarDrawerToggle,
	useSidebarDrawer,
} from "./workspace-drawer";

// P2-T2 (docs/local-agent-workspace-plan.md): the /local/$tokenId two-pane
// workspace — session sidebar (left, route-local) + multi-tab content pane
// (right; S3-T2 extracted that pane into SessionWorkspacePane so the Task
// Conversation page can reuse it). Session selection is URL-driven
// (`?session=`): the route passes it down and turns sidebar clicks into
// `navigate({ search })`.

/** The chat tab's content: the selected session's terminal, or the
 * waiting-for-CLI guide when this token has no session yet. Rendered into
 * `SessionWorkspacePane`'s kept-alive chat slot. */
function LocalChat({
	activeSession,
	entry,
	userAvatarUrl,
}: {
	activeSession: BridgeSessionRow | null;
	entry: LocalAgentEntry;
	userAvatarUrl: string | undefined;
}) {
	if (activeSession) {
		return (
			<SessionView
				activeSession={activeSession}
				token={entry.token}
				userAvatarUrl={userAvatarUrl}
			/>
		);
	}
	return (
		<div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
			<WaitingForCli token={entry.token} />
		</div>
	);
}

/** Loading state mirroring the final two-pane shape: sidebar skeleton (md+)
 * beside the existing detail skeleton. */
function WorkspaceSkeleton() {
	return (
		<div className="flex min-h-0 flex-1">
			<aside className="hidden w-64 shrink-0 flex-col bg-muted/30 md:flex">
				<WorkspaceSidebarSkeleton />
			</aside>
			<div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-4 sm:p-6">
				<Skeleton className="h-7 w-56 rounded-lg" />
				<LocalAgentDetailSkeleton />
			</div>
		</div>
	);
}

/** The assembled two-pane layout — the token-bound parts (sidebar, drawer,
 * settings command bridge) around the extracted session-level pane. The <md
 * drawer pattern (overlay + toggle + state trio) is shared with the task
 * page's run sidebar — see workspace-drawer.tsx. */
function WorkspaceLayout({
	activeSession,
	entry,
	onSelectSession,
	sidebar,
	userAvatarUrl,
}: {
	activeSession: BridgeSessionRow | null;
	entry: LocalAgentEntry;
	onSelectSession: (sessionId: string) => void;
	sidebar: (onSelect: (sessionId: string) => void) => ReactNode;
	userAvatarUrl: string | undefined;
}) {
	const drawer = useSidebarDrawer(onSelectSession);
	return (
		<div className="flex min-h-0 flex-1">
			<aside className="hidden w-64 shrink-0 flex-col bg-muted/30 md:flex">
				{sidebar(onSelectSession)}
			</aside>
			<SessionWorkspacePane
				chat={
					<LocalChat
						activeSession={activeSession}
						entry={entry}
						userAvatarUrl={userAvatarUrl}
					/>
				}
				companion={({ setTab, tab }) => (
					<WorkspaceCommandBridge
						activeSession={activeSession}
						entry={entry}
						setTab={setTab}
						tab={tab}
					/>
				)}
				headerStart={
					<SidebarDrawerToggle label="Show sessions" onOpen={drawer.show} />
				}
			/>
			<MobileSidebarDrawer
				closeLabel="Close session list"
				onClose={drawer.close}
				open={drawer.open}
			>
				{sidebar(drawer.select)}
			</MobileSidebarDrawer>
		</div>
	);
}

/**
 * The `/local/$tokenId` body. One bridge token = one persistent local agent.
 * Joins `listTokens` + the paginated `listSessions` (first page polled, older
 * pages behind "Load more"), then:
 *  - unknown/revoked token → not-found;
 *  - token with no session yet → waiting-for-CLI beside the (empty) sidebar;
 *  - token with sessions → sidebar + the `?session=`-selected terminal.
 */
export function LocalAgentWorkspace({
	onSelectSession,
	sessionId,
	tokenId,
}: {
	onSelectSession: (sessionId: string) => void;
	sessionId: string | undefined;
	tokenId: string;
}) {
	const tokens = useQuery(orpc.bridge.listTokens.queryOptions());
	const paged = useWorkspaceSessions(tokenId);
	const { email } = useCurrentUser();

	if (tokens.isPending || paged.isPending) {
		return <WorkspaceSkeleton />;
	}

	const entries = deriveLocalAgentEntries(tokens.data ?? [], paged.sessions);
	const entry = entries.find((candidate) => candidate.token.id === tokenId);
	if (!entry) {
		return <LocalAgentNotFound />;
	}

	const tokenSessions = sortSessionsByRecency(
		paged.sessions.filter((session) => session.tokenId === tokenId)
	);
	const activeSession = pickActiveSession(tokenSessions, sessionId);

	return (
		<WorkspaceLayout
			activeSession={activeSession}
			entry={entry}
			onSelectSession={onSelectSession}
			sidebar={(onSelect) => (
				<LocalAgentWorkspaceSidebar
					activeSessionId={activeSession?.id ?? null}
					entry={entry}
					hasMore={paged.hasMore}
					isLoadingMore={paged.isLoadingMore}
					onLoadMore={paged.loadMore}
					onSelectSession={onSelect}
					sessions={tokenSessions}
				/>
			)}
			userAvatarUrl={email ? userAvatar(email) : undefined}
		/>
	);
}
