import { useEffect, useState } from "react";
import { registerWorkspaceCommandTarget } from "@/components/command-palette/command-palette-store";
import type { BridgeSessionRow } from "@/utils/api-types";
import type { LocalAgentEntry } from "./local-agent-join";
import { LocalAgentSettingsDialog } from "./local-agent-settings-dialog";
import type { WorkspaceTabId } from "./local-agent-workspace-tabs";

// P2-T3: the workspace side of the ⌘K palette. Registers the mounted
// workspace's tab state + a settings opener with the palette's module store
// (no lifting of tab state out of WorkspaceLayout, so the kept-alive chat
// pane is untouched) and lazily hosts the settings dialog the palette's
// "Agent settings…" item opens — same lazy-mount discipline as
// terminal-header-overflow-menu.tsx.

/** Registers `{tokenId, tab, setTab, openSettings}` while mounted; returns
 * the settings-dialog open state the host renders from. Re-registers on tab
 * change so the palette always sees the current tab. */
export function useWorkspaceCommandRegistration({
	setTab,
	tab,
	tokenId,
}: {
	setTab: (tab: WorkspaceTabId) => void;
	tab: WorkspaceTabId;
	tokenId: string;
}) {
	const [settingsOpen, setSettingsOpen] = useState(false);
	useEffect(
		() =>
			registerWorkspaceCommandTarget({
				openSettings: () => setSettingsOpen(true),
				setTab,
				tab,
				tokenId,
			}),
		[setTab, tab, tokenId]
	);
	return { setSettingsOpen, settingsOpen };
}

/** Rendered by WorkspaceLayout beside the panes: owns the palette
 * registration and the lazily mounted per-agent settings dialog. */
export function WorkspaceCommandBridge({
	activeSession,
	entry,
	setTab,
	tab,
}: {
	activeSession: BridgeSessionRow | null;
	entry: LocalAgentEntry;
	setTab: (tab: WorkspaceTabId) => void;
	tab: WorkspaceTabId;
}) {
	const { setSettingsOpen, settingsOpen } = useWorkspaceCommandRegistration({
		setTab,
		tab,
		tokenId: entry.token.id,
	});
	if (!settingsOpen) {
		return null;
	}
	return (
		<LocalAgentSettingsDialog
			onOpenChange={setSettingsOpen}
			open={settingsOpen}
			sessionId={activeSession?.id}
			token={entry.token}
		/>
	);
}
