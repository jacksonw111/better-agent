import { Button } from "@better-agent/ui/components/button";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { PanelLeftIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
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

// P2-T2 (docs/local-agent-workspace-plan.md): the /local/$tokenId two-pane
// workspace — session sidebar (left, route-local) + multi-tab content pane
// (right; S3-T2 extracted that pane into SessionWorkspacePane so the Task
// Conversation page can reuse it). Session selection is URL-driven
// (`?session=`): the route passes it down and turns sidebar clicks into
// `navigate({ search })`.

/** <md: the sidebar collapses into this overlay drawer, toggled from the
 * content pane's header. A plain fixed panel (the ui package has no Sheet);
 * the backdrop is a real button so it closes by tap or keyboard. `w-4/5
 * max-w-72` keeps a tappable backdrop sliver even at 320px, and
 * `pb-safe-bottom` clears the home indicator under the sidebar's bottom
 * toggle (the workspace route is immersive, so no dock reserves that space). */
function MobileSessionDrawer({
	children,
	onClose,
	open,
}: {
	children: ReactNode;
	onClose: () => void;
	open: boolean;
}) {
	if (!open) {
		return null;
	}
	return (
		<div className="fixed inset-0 z-50 md:hidden">
			<button
				aria-label="Close session list"
				className="absolute inset-0 bg-black/40"
				onClick={onClose}
				type="button"
			/>
			<div className="absolute inset-y-0 left-0 flex w-4/5 max-w-72 flex-col bg-background pb-safe-bottom shadow-lg">
				{children}
			</div>
		</div>
	);
}

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

/** The <md header button that opens the session drawer — the workspace's
 * `headerStart` slot content, split out for the max-lines-per-function gate. */
function DrawerToggle({ onOpen }: { onOpen: () => void }) {
	return (
		<Button
			aria-label="Show sessions"
			className="md:hidden"
			onClick={onOpen}
			size="icon-sm"
			variant="ghost"
		>
			<PanelLeftIcon className="size-4" />
		</Button>
	);
}

/** The <md drawer's open/close/select-and-close trio, packaged to keep
 * `WorkspaceLayout` under the max-lines-per-function gate. */
function useDrawer(onSelectSession: (sessionId: string) => void) {
	const [open, setOpen] = useState(false);
	return {
		close: () => setOpen(false),
		open,
		select: (sessionId: string) => {
			onSelectSession(sessionId);
			setOpen(false);
		},
		show: () => setOpen(true),
	};
}

/** The assembled two-pane layout — the token-bound parts (sidebar, drawer,
 * settings command bridge) around the extracted session-level pane. */
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
	const drawer = useDrawer(onSelectSession);
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
				headerStart={<DrawerToggle onOpen={drawer.show} />}
			/>
			<MobileSessionDrawer onClose={drawer.close} open={drawer.open}>
				{sidebar(drawer.select)}
			</MobileSessionDrawer>
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
