import { Button } from "@better-agent/ui/components/button";
import { PowerIcon, SettingsIcon } from "lucide-react";
import { useState } from "react";
import type { BridgeSessionRow, BridgeTokenRow } from "@/utils/api-types";
import type { AgentCapabilities } from "./agent-capabilities";
import type {
	SessionListDetail,
	SessionReadyDetail,
} from "./bridge-session-status";
import { AgentKindIcon } from "./local-agent-kind-icon";
import { LocalAgentSessionPicker } from "./local-agent-session-picker";
import { LocalAgentSettingsDialog } from "./local-agent-settings-dialog";
import { PastConversations } from "./past-conversations";
import { SessionStatusHeader } from "./session-status-header";
import type { TerminalConnectionStatus } from "./terminal-status";
import { TerminalStatus } from "./terminal-status";

/** Short enough to identify a session at a glance without dominating the row
 * — matches how git short-SHAs are conventionally truncated. */
const SESSION_ID_SHORT_LENGTH = 8;

function shortSessionId(id: string): string {
	return id.length > SESSION_ID_SHORT_LENGTH
		? `${id.slice(0, SESSION_ID_SHORT_LENGTH)}…`
		: id;
}

/** `Session: 11c186d9…` — the ONE prominent identifier for the session, the
 * agent/claude session id when the CLI has reported one, else the bridge
 * session id. Full id in the tooltip. Deliberately not the session `label`,
 * which is routinely "untitled". */
function SessionIdLabel({
	agentKind,
	sessionId,
}: {
	agentKind: BridgeSessionRow["agentKind"];
	sessionId: string;
}) {
	return (
		<span className="flex min-w-0 items-center gap-2">
			<AgentKindIcon
				className="size-4 shrink-0 text-muted-foreground"
				kind={agentKind}
			/>
			<span className="truncate font-medium text-sm" title={sessionId}>
				Session: {shortSessionId(sessionId)}
			</span>
		</span>
	);
}

interface TerminalHeaderActionsProps {
	activeSessionId?: string | null;
	canSend: boolean;
	caps: AgentCapabilities;
	ending: boolean;
	listSessions: () => void;
	onEnd?: () => void;
	onSelectSession?: (sessionId: string) => void;
	sessionList: SessionListDetail | null;
	/** This token's sibling sessions — when present (with `onSelectSession`)
	 * the header offers a session picker so the user can switch which
	 * conversation the terminal follows (Phase 4 follow-up: the picker moved
	 * out of a standalone bar above the terminal into the session chrome). */
	sessions?: BridgeSessionRow[];
	status: TerminalConnectionStatus;
	/** The bridge token this session belongs to — drives the Settings dialog
	 * (edits the token's persisted config). */
	token?: BridgeTokenRow;
}

/** The session picker + Settings entry — the detail-page-level controls that
 * now live in the session's top-right (Phase 4 follow-up). Settings is
 * lazy-mounted so the react-query wiring only spins up once opened. */
function SessionControls({
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
							token={token}
						/>
					)}
				</>
			)}
		</>
	);
}

/** The header's right-hand action cluster: session picker + Settings, past
 * conversations and the End button — each gated on `caps`/props. Split out
 * purely to keep `TerminalHeader` under the repo's max-lines-per-function
 * gate. */
function TerminalHeaderActions({
	activeSessionId,
	canSend,
	caps,
	ending,
	listSessions,
	onEnd,
	onSelectSession,
	sessionList,
	sessions,
	status,
	token,
}: TerminalHeaderActionsProps) {
	const showEnd = status !== "ended" && onEnd !== undefined;
	return (
		<div className="flex flex-wrap items-center gap-1.5">
			<SessionControls
				activeSessionId={activeSessionId}
				onSelectSession={onSelectSession}
				sessions={sessions}
				token={token}
			/>
			{caps.sessionList && (
				<PastConversations
					disabled={!canSend}
					onRequestList={listSessions}
					sessionList={sessionList}
				/>
			)}
			{showEnd && (
				<Button
					aria-label="End local agent session"
					className="text-destructive hover:text-destructive"
					disabled={ending}
					onClick={onEnd}
					size="icon-sm"
					title="End local agent session"
					variant="ghost"
				>
					<PowerIcon className="size-4" />
				</Button>
			)}
		</div>
	);
}

export interface TerminalHeaderProps extends TerminalHeaderActionsProps {
	agentKind: BridgeSessionRow["agentKind"];
	sessionId: string;
	sessionReady: SessionReadyDetail | null;
}

/** The single header for a Local Agent session: the prominent session id, the
 * ONE connection-status indicator, the capability summary, and the session
 * actions — each gated on `caps` (see agent-capabilities.ts) so a session only
 * shows what its running agent supports. No background — a bottom border like
 * the chat agent's header (chat-view.tsx), so the whole detail view is one
 * cohesive surface. */
export function TerminalHeader({
	agentKind,
	sessionId,
	sessionReady,
	status,
	...actions
}: TerminalHeaderProps) {
	return (
		<div className="shrink-0 border-b">
			{/* Inner column matches the chat feed's `max-w-3xl mx-auto` so the
			 * session id, status strip, and actions sit on the SAME grid lines
			 * as the messages below. */}
			<div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-3 py-2.5 sm:px-4">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<div className="flex min-w-0 items-center gap-2.5">
						<SessionIdLabel agentKind={agentKind} sessionId={sessionId} />
						<TerminalStatus status={status} />
					</div>
					<TerminalHeaderActions {...actions} status={status} />
				</div>
				<SessionStatusHeader detail={sessionReady} />
			</div>
		</div>
	);
}
