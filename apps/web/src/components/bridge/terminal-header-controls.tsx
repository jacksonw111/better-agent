import { Button } from "@better-agent/ui/components/button";
import { PowerIcon, SettingsIcon } from "lucide-react";
import { useState } from "react";
import type { BridgeSessionRow, BridgeTokenRow } from "@/utils/api-types";
import type { AgentCapabilities } from "./agent-capabilities";
import type { SessionListDetail } from "./bridge-session-list";
import type { UsageUpdateDetail } from "./bridge-session-status";
import type { StatusSnapshotDetail } from "./bridge-status-snapshot";
import { deriveContextPct } from "./bridge-usage-format";
import { ContextMiniBar } from "./context-mini-bar";
import { LocalAgentSessionPicker } from "./local-agent-session-picker";
import { LocalAgentSettingsDialog } from "./local-agent-settings-dialog";
import { PastConversations } from "./past-conversations";
import { StatusSnapshotPanel } from "./status-snapshot-panel";
import type { TerminalConnectionStatus } from "./terminal-status";

// The header's right-hand action controls, split out of terminal-header.tsx
// so both the full desktop cluster (terminal-header.tsx) and the <sm
// overflow menu (terminal-header-overflow-menu.tsx) can render the SAME
// components without an import cycle between those two files (D4).

export interface TerminalHeaderActionsProps {
	activeSessionId?: string | null;
	canSend: boolean;
	caps: AgentCapabilities;
	ending: boolean;
	/** Requests a fresh `status_snapshot` — wired to the Status button. */
	getStatus: () => Promise<void>;
	listSessions: () => void;
	onEnd?: () => void;
	onSelectSession?: (sessionId: string) => void;
	/** Asks the CLI to tear down and relaunch under the same sessionId (R3) —
	 * wired to the Restart button, gated the same as End (hidden once the
	 * session has ended). */
	restart: () => Promise<void>;
	sessionList: SessionListDetail | null;
	/** This token's sibling sessions — when present (with `onSelectSession`)
	 * the header offers a session picker so the user can switch which
	 * conversation the terminal follows (Phase 4 follow-up: the picker moved
	 * out of a standalone bar above the terminal into the session chrome). */
	sessions?: BridgeSessionRow[];
	status: TerminalConnectionStatus;
	/** The latest `status_snapshot` detail — passed straight to the Status
	 * button's popover. */
	statusSnapshot: StatusSnapshotDetail | null;
	/** The bridge token this session belongs to — drives the Settings dialog
	 * (edits the token's persisted config). */
	token?: BridgeTokenRow;
	/** The latest streamed `usage_update` detail (opencode's context/cost) — the
	 * mini bar's primary source, ahead of `statusSnapshot`'s own context usage
	 * (see `deriveContextPct`). */
	usageUpdate: UsageUpdateDetail | null;
}

/** The session picker + Settings entry — the detail-page-level controls that
 * now live in the session's top-right (Phase 4 follow-up). Settings is
 * lazy-mounted so the react-query wiring only spins up once opened. */
export function SessionControls({
	activeSessionId,
	onSelectSession,
	sessions,
	token,
}: {
	activeSessionId?: string | null;
	onSelectSession?: (sessionId: string) => void;
	sessions?: BridgeSessionRow[];
	token?: BridgeTokenRow;
}) {
	const [settingsOpen, setSettingsOpen] = useState(false);
	return (
		<>
			{sessions && onSelectSession && sessions.length > 0 && (
				<LocalAgentSessionPicker
					activeId={activeSessionId ?? null}
					onSelect={onSelectSession}
					sessions={sessions}
				/>
			)}
			{token && (
				<>
					<Button
						aria-label="Settings"
						onClick={() => setSettingsOpen(true)}
						size="icon-sm"
						variant="ghost"
					>
						<SettingsIcon className="size-4" />
					</Button>
					{settingsOpen && (
						<LocalAgentSettingsDialog
							onOpenChange={setSettingsOpen}
							open={settingsOpen}
							sessionId={activeSessionId ?? undefined}
							token={token}
						/>
					)}
				</>
			)}
		</>
	);
}

/** The two on-demand data popovers, each gated on its own capability. */
export function SessionDataActions({
	canSend,
	caps,
	getStatus,
	listSessions,
	sessionList,
	statusSnapshot,
	usageUpdate,
}: {
	canSend: boolean;
	caps: AgentCapabilities;
	getStatus: () => Promise<void>;
	listSessions: () => void;
	sessionList: SessionListDetail | null;
	statusSnapshot: StatusSnapshotDetail | null;
	usageUpdate: UsageUpdateDetail | null;
}) {
	const contextPct = deriveContextPct(usageUpdate, statusSnapshot);
	return (
		<>
			{caps.sessionList && (
				<PastConversations
					disabled={!canSend}
					onRequestList={listSessions}
					sessionList={sessionList}
				/>
			)}
			{caps.contextUsage && (
				<>
					{contextPct !== null && <ContextMiniBar pct={contextPct} />}
					<StatusSnapshotPanel
						detail={statusSnapshot}
						onRequestStatus={getStatus}
					/>
				</>
			)}
		</>
	);
}

/** Touch-target bump (min-h/w-11) below `sm` so the header's destructive
 * control clears the 44px thumb-target minimum on mobile (D4). */
export function EndSessionButton({
	ending,
	onEnd,
}: {
	ending: boolean;
	onEnd: () => void;
}) {
	return (
		<Button
			aria-label="End local agent session"
			className="min-h-11 min-w-11 text-destructive hover:text-destructive sm:min-h-0 sm:min-w-0"
			disabled={ending}
			onClick={onEnd}
			size="icon-sm"
			title="End local agent session"
			variant="ghost"
		>
			<PowerIcon className="size-4" />
		</Button>
	);
}
