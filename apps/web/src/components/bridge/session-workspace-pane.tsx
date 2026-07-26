import { Button } from "@better-agent/ui/components/button";
import { type ReactNode, useState } from "react";
import { setCommandPaletteOpen } from "@/components/command-palette/command-palette-store";
import { QuickSettings } from "@/components/quick-settings";
import {
	LocalAgentWorkspaceTabs,
	type WorkspaceTabId,
} from "./local-agent-workspace-tabs";

// S3-T2 (master spec §17.3, plan D8): the SESSION-level core of the local
// agent workspace. It hosts only the chat pane now.
// TODO(P2-3 / Appendix A.4 #2): the Files/Git/Shell inspection panes were
// removed here because they were fed by the deleted structured event channel
// (fs/git/shell-channel-store over the bridge SSE transport). They return as a
// workspace code browser once rewired onto a thin RPC transport — the tab row
// (local-agent-workspace-tabs.tsx) hides them until then.

/** The mounted workspace's tab state, exposed to the host's `companion` slot
 * (e.g. /local's ⌘K command bridge, which registers tab switching). */
export interface SessionWorkspaceTabContext {
	setTab: (tab: WorkspaceTabId) => void;
	tab: WorkspaceTabId;
}

/** The content pane's top strip: the host's leading slot (e.g. the <md
 * sidebar toggle) beside the tab row, with ⌘K + quick settings trailing. */
function PaneHeader({
	headerStart,
	onTabChange,
	tab,
}: {
	headerStart: ReactNode;
	onTabChange: (tab: WorkspaceTabId) => void;
	tab: WorkspaceTabId;
}) {
	return (
		<div className="flex shrink-0 items-center gap-1 px-3 pt-2 sm:px-4">
			{headerStart}
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

/**
 * The session workspace's content pane: tab row + the kept-alive chat area.
 * The chat slot stays MOUNTED whatever the active tab (hidden/flex, never
 * unmounted), so tab switches can't remount the terminal mid-session — the
 * invariant the whole pane was built around (P2-T2).
 */
export function SessionWorkspacePane({
	chat,
	companion,
	headerStart,
}: {
	/** The chat tab's content — /local renders its PTY terminal / waiting-for-CLI
	 * pair here. */
	chat: ReactNode;
	/** Rendered with the live tab state — /local's ⌘K workspace command bridge;
	 * omit when the host has none. */
	companion?: (context: SessionWorkspaceTabContext) => ReactNode;
	/** Leading header slot before the tab row — /local's <md drawer toggle. */
	headerStart?: ReactNode;
}) {
	const [tab, setTab] = useState<WorkspaceTabId>("chat");
	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col">
			<PaneHeader headerStart={headerStart} onTabChange={setTab} tab={tab} />
			<div
				className={tab === "chat" ? "flex min-h-0 flex-1 flex-col" : "hidden"}
			>
				{chat}
			</div>
			{companion?.({ setTab, tab })}
		</div>
	);
}
