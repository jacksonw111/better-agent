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
	/** S3 task page: hides the Past conversations trigger even when the agent's
	 * capability matrix supports it (the run sidebar covers history there).
	 * Never set on /local. */
	hidePastConversations?: boolean;
	/** S3 task page: hides the Status popover trigger (same gating shape as
	 * `hidePastConversations`). Never set on /local. */
	hideStatusButton?: boolean;
	listSessions: () => void;
	onEnd?: () => void;
	onSelectSession?: (sessionId: string) => void;
	/** Controls the Settings dialog's open state from OUTSIDE `SessionControls`
	 * — used by the <sm overflow menu, which hoists the dialog (and this
	 * state) to its own top level, sibling of the DropdownMenu, so the dialog
	 * survives Base UI unmounting `DropdownMenuContent` when the menu closes
	 * (D4 fix). Left unset for the sm-and-up desktop cluster, where
	 * `SessionControls` isn't nested in anything that can unmount it, so it
	 * keeps owning the state itself. */
	onSettingsOpenChange?: (open: boolean) => void;
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
	settingsOpen?: boolean;
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

/** A boolean that's owned locally UNLESS the caller passes `onChange`, in
 * which case the caller owns it instead (controlled) — factored out of
 * `SessionControls` purely to keep that function under the repo's
 * max-lines/complexity gates. Also reports whether it ended up controlled,
 * since `SessionControls` needs that to decide whether IT should render the
 * Settings dialog or leave that to the (now hoisting) caller. */
function useControllableOpen(
	valueProp: boolean | undefined,
	onChange: ((open: boolean) => void) | undefined
): [boolean, (open: boolean) => void, boolean] {
	const [internal, setInternal] = useState(false);
	if (onChange) {
		return [valueProp ?? false, onChange, true];
	}
	return [internal, setInternal, false];
}

/** The Settings button + its dialog — split out of `SessionControls` purely
 * to keep that function under the repo's max-lines gate. When `controlled`
 * (the <sm overflow menu, D4 fix) the caller renders the dialog itself
 * elsewhere, hoisted somewhere that survives the menu closing — this only
 * renders the trigger button in that case. */
function SettingsControl({
	activeSessionId,
	controlled,
	setSettingsOpen,
	settingsOpen,
	token,
}: {
	activeSessionId?: string | null;
	controlled: boolean;
	setSettingsOpen: (open: boolean) => void;
	settingsOpen: boolean;
	token: BridgeTokenRow;
}) {
	return (
		<>
			<Button
				aria-label="Settings"
				onClick={() => setSettingsOpen(true)}
				size="icon-sm"
				variant="ghost"
			>
				<SettingsIcon className="size-4" />
			</Button>
			{!controlled && settingsOpen && (
				<LocalAgentSettingsDialog
					onOpenChange={setSettingsOpen}
					open={settingsOpen}
					sessionId={activeSessionId ?? undefined}
					token={token}
				/>
			)}
		</>
	);
}

/** The session picker + Settings entry — the detail-page-level controls that
 * now live in the session's top-right (Phase 4 follow-up). Settings is
 * lazy-mounted so the react-query wiring only spins up once opened.
 *
 * The dialog's open state is normally owned right here (uncontrolled) — fine
 * for the sm-and-up desktop cluster, which renders this directly and is
 * never unmounted out from under it. When `onSettingsOpenChange` is passed
 * (the <sm overflow menu, D4 fix), that state is CONTROLLED by the caller
 * instead, and the caller — not this component — renders the dialog itself,
 * hoisted somewhere that survives the menu closing. */
export function SessionControls({
	activeSessionId,
	onSelectSession,
	onSettingsOpenChange,
	sessions,
	settingsOpen: settingsOpenProp,
	token,
}: {
	activeSessionId?: string | null;
	onSelectSession?: (sessionId: string) => void;
	onSettingsOpenChange?: (open: boolean) => void;
	sessions?: BridgeSessionRow[];
	settingsOpen?: boolean;
	token?: BridgeTokenRow;
}) {
	const [settingsOpen, setSettingsOpen, controlled] = useControllableOpen(
		settingsOpenProp,
		onSettingsOpenChange
	);
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
				<SettingsControl
					activeSessionId={activeSessionId}
					controlled={controlled}
					setSettingsOpen={setSettingsOpen}
					settingsOpen={settingsOpen}
					token={token}
				/>
			)}
		</>
	);
}

/** The two on-demand data popovers, each gated on its own capability — and,
 * for the task page, on the host's `hide*` props (see
 * `TerminalHeaderActionsProps`); the context mini-bar stays either way. */
export function SessionDataActions({
	canSend,
	caps,
	getStatus,
	hidePastConversations,
	hideStatusButton,
	listSessions,
	sessionList,
	statusSnapshot,
	usageUpdate,
}: {
	canSend: boolean;
	caps: AgentCapabilities;
	getStatus: () => Promise<void>;
	hidePastConversations?: boolean;
	hideStatusButton?: boolean;
	listSessions: () => void;
	sessionList: SessionListDetail | null;
	statusSnapshot: StatusSnapshotDetail | null;
	usageUpdate: UsageUpdateDetail | null;
}) {
	const contextPct = deriveContextPct(usageUpdate, statusSnapshot);
	return (
		<>
			{caps.sessionList && !hidePastConversations && (
				<PastConversations
					disabled={!canSend}
					onRequestList={listSessions}
					sessionList={sessionList}
				/>
			)}
			{caps.contextUsage && (
				<>
					{contextPct !== null && <ContextMiniBar pct={contextPct} />}
					{!hideStatusButton && (
						<StatusSnapshotPanel
							detail={statusSnapshot}
							onRequestStatus={getStatus}
						/>
					)}
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
