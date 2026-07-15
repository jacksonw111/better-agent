import { Button } from "@better-agent/ui/components/button";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { PanelLeftIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { setCommandPaletteOpen } from "@/components/command-palette/command-palette-store";
import { QuickSettings } from "@/components/quick-settings";
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
import { LocalAgentFilesPane } from "./local-agent-files-pane";
import { LocalAgentGitPane } from "./local-agent-git-pane";
import {
	deriveLocalAgentEntries,
	type LocalAgentEntry,
} from "./local-agent-join";
import { sortSessionsByRecency } from "./local-agent-session-picker";
import { LocalAgentShellPane } from "./local-agent-shell-pane";
import { WorkspaceCommandBridge } from "./local-agent-workspace-command-bridge";
import {
	pickActiveSession,
	useWorkspaceSessions,
} from "./local-agent-workspace-sessions";
import {
	LocalAgentWorkspaceSidebar,
	WorkspaceSidebarSkeleton,
} from "./local-agent-workspace-sidebar";
import {
	LocalAgentWorkspaceTabs,
	type WorkspaceTabId,
} from "./local-agent-workspace-tabs";

// P2-T2 (docs/local-agent-workspace-plan.md): the /local/$tokenId two-pane
// workspace — session sidebar (left, route-local) + multi-tab content pane
// (right; chat live, files/git/shell placeholders until P4). Session
// selection is URL-driven (`?session=`): the route passes it down and turns
// sidebar clicks into `navigate({ search })`.

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

/** Chat pane, kept mounted regardless of the active tab (hidden/block, never
 * unmounted) so future P4 tabs can't remount the terminal mid-session. */
function ChatPane({
	activeSession,
	entry,
	hidden,
	userAvatarUrl,
}: {
	activeSession: BridgeSessionRow | null;
	entry: LocalAgentEntry;
	hidden: boolean;
	userAvatarUrl: string | undefined;
}) {
	return (
		<div className={hidden ? "hidden" : "flex min-h-0 flex-1 flex-col"}>
			{activeSession ? (
				<SessionView
					activeSession={activeSession}
					token={entry.token}
					userAvatarUrl={userAvatarUrl}
				/>
			) : (
				<div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
					<WaitingForCli token={entry.token} />
				</div>
			)}
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

/** The content pane's top strip: the <md sidebar toggle beside the tab row. */
function ContentPaneHeader({
	onOpenDrawer,
	onTabChange,
	tab,
}: {
	onOpenDrawer: () => void;
	onTabChange: (tab: WorkspaceTabId) => void;
	tab: WorkspaceTabId;
}) {
	return (
		<div className="flex shrink-0 items-center gap-1 px-3 pt-2 sm:px-4">
			<Button
				aria-label="Show sessions"
				className="md:hidden"
				onClick={onOpenDrawer}
				size="icon-sm"
				variant="ghost"
			>
				<PanelLeftIcon className="size-4" />
			</Button>
			<LocalAgentWorkspaceTabs onChange={onTabChange} value={tab} />
			<Button
				aria-label="Open command palette"
				className="ml-auto shrink-0 font-mono text-muted-foreground"
				onClick={() => setCommandPaletteOpen(true)}
				size="sm"
				variant="ghost"
			>
				⌘K
			</Button>
			<QuickSettings />
		</div>
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

/** The assembled two-pane layout — split from `LocalAgentWorkspace` (which
 * owns the queries and guards) to stay under the max-lines-per-function gate. */
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
	const [tab, setTab] = useState<WorkspaceTabId>("chat");
	const drawer = useDrawer(onSelectSession);
	return (
		<div className="flex min-h-0 flex-1">
			<aside className="hidden w-64 shrink-0 flex-col bg-muted/30 md:flex">
				{sidebar(onSelectSession)}
			</aside>
			<div className="flex min-h-0 min-w-0 flex-1 flex-col">
				<ContentPaneHeader
					onOpenDrawer={drawer.show}
					onTabChange={setTab}
					tab={tab}
				/>
				<ChatPane
					activeSession={activeSession}
					entry={entry}
					hidden={tab !== "chat"}
					userAvatarUrl={userAvatarUrl}
				/>
				<LocalAgentShellPane hidden={tab !== "shell"} />
				<LocalAgentFilesPane hidden={tab !== "files"} />
				<LocalAgentGitPane hidden={tab !== "git"} />
			</div>
			<MobileSessionDrawer onClose={drawer.close} open={drawer.open}>
				{sidebar(drawer.select)}
			</MobileSessionDrawer>
			<WorkspaceCommandBridge
				activeSession={activeSession}
				entry={entry}
				setTab={setTab}
				tab={tab}
			/>
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
