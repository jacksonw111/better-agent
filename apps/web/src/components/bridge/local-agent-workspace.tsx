import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { PtyTerminal } from "@/components/pty/pty-terminal";
import type { BridgeSessionRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";
import { LocalAgentNotFound, WaitingForCli } from "./local-agent-detail";
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
import {
	SessionWorkspacePane,
	type SessionWorkspaceTabContext,
} from "./session-workspace-pane";
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

/** The `?pty=<computerId>` feature gate (DP-PTY6): which computer's PTY relay
 * to attach to, and optionally which sessionId (defaults to the selected bridge
 * session). Absent = the legacy structured terminal. Removed in P2-3. */
export interface PtyGate {
	computerId: string;
	sessionId?: string;
}

/** The notice shown for a legacy bridge session opened without a `?pty=`
 * computer. P2-3 deleted the structured terminal renderer; the live terminal is
 * now the native PTY xterm, which needs the owning computer id (a bridge
 * session row doesn't carry one). New terminals open from the Computer page's
 * "Open terminal" entry. */
function LegacyTerminalNotice() {
	return (
		<div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
			<div className="rounded-lg bg-muted/40 p-6">
				<p className="font-medium text-sm">
					Terminal moved to the PTY terminal
				</p>
				<p className="text-muted-foreground text-sm">
					The legacy in-page terminal has been replaced by the native PTY
					terminal. Open one from your computer's page, or open this workspace
					with a <code className="font-mono">?pty=&lt;computerId&gt;</code> link
					to attach here.
				</p>
			</div>
		</div>
	);
}

/** The chat tab's content: the selected session's PTY terminal (when the URL
 * names a computer via `?pty=`), a moved-terminal notice for legacy sessions,
 * or the waiting-for-CLI guide when this token has no session yet. Rendered into
 * `SessionWorkspacePane`'s kept-alive chat slot. */
function LocalChat({
	activeSession,
	entry,
	pty,
}: {
	activeSession: BridgeSessionRow | null;
	entry: LocalAgentEntry;
	pty?: PtyGate;
}) {
	// The native xterm PTY terminal, attached to the selected session unless
	// `?ptySession=` overrides. Needs the owning computer id from `?pty=`.
	if (pty && activeSession) {
		return (
			<div className="min-h-0 flex-1 p-3 sm:p-4">
				<PtyTerminal
					computerId={pty.computerId}
					sessionId={pty.sessionId ?? activeSession.id}
				/>
			</div>
		);
	}
	if (activeSession) {
		return <LegacyTerminalNotice />;
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

/** The pane's `companion` slot: /local's ⌘K workspace command bridge, bound to
 * the live tab state. Extracted so WorkspaceLayout stays within the line cap. */
function renderWorkspaceCompanion(
	activeSession: BridgeSessionRow | null,
	entry: LocalAgentEntry
) {
	return ({ setTab, tab }: SessionWorkspaceTabContext) => (
		<WorkspaceCommandBridge
			activeSession={activeSession}
			entry={entry}
			setTab={setTab}
			tab={tab}
		/>
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
	pty,
	sidebar,
}: {
	activeSession: BridgeSessionRow | null;
	entry: LocalAgentEntry;
	onSelectSession: (sessionId: string) => void;
	pty?: PtyGate;
	sidebar: (onSelect: (sessionId: string) => void) => ReactNode;
}) {
	const drawer = useSidebarDrawer(onSelectSession);
	return (
		<div className="flex min-h-0 flex-1">
			<aside className="hidden w-64 shrink-0 flex-col bg-muted/30 md:flex">
				{sidebar(onSelectSession)}
			</aside>
			<SessionWorkspacePane
				chat={
					<LocalChat activeSession={activeSession} entry={entry} pty={pty} />
				}
				companion={renderWorkspaceCompanion(activeSession, entry)}
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
	pty,
	sessionId,
	tokenId,
}: {
	onSelectSession: (sessionId: string) => void;
	pty?: PtyGate;
	sessionId: string | undefined;
	tokenId: string;
}) {
	const tokens = useQuery(orpc.bridge.listTokens.queryOptions());
	const paged = useWorkspaceSessions(tokenId);

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
			pty={pty}
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
		/>
	);
}
