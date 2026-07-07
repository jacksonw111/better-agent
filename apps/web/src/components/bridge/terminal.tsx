import type { ChatAvatars } from "@better-agent/ui/components/chat/chat-row";
import { useMemo } from "react";
import type { BridgeSessionRow, BridgeTokenRow } from "@/utils/api-types";
import { agentAvatar } from "@/utils/avatar";
import { type AgentCapabilities, capabilities } from "./agent-capabilities";
import type { StreamEvent } from "./bridge-events";
import type {
	SessionReadyDetail,
	TurnUsageDetail,
	UsageUpdateDetail,
} from "./bridge-session-status";
import type { BridgeTransport } from "./bridge-transport";
import { type BridgeTurn, foldEventsToTurns } from "./bridge-turns";
import { TerminalComposer } from "./terminal-composer";
import { TerminalFeed } from "./terminal-feed";
import { TerminalHeader } from "./terminal-header";
import { TurnUsagePanel } from "./turn-usage-panel";
import { UsageUpdateLine } from "./usage-update-line";
import { useBridgeTerminal } from "./use-bridge-terminal";

export interface TerminalProps {
	/** The bridge session id the terminal is currently showing — drives the
	 * session picker's highlight when `sessions` is provided. */
	activeSessionId?: string | null;
	/** Whether an end-session request is in flight — disables the End button.
	 * Only meaningful alongside `onEnd`. */
	ending?: boolean;
	/** Ends this session. Wired by the detail page; omitted (with the End
	 * button then hidden) when there's no session to end, e.g. in unit tests. */
	onEnd?: () => void;
	/** Switches which of `sessions` the terminal follows — wired by the detail
	 * page; when omitted the picker stays hidden. */
	onSelectSession?: (sessionId: string) => void;
	session: BridgeSessionRow;
	/** This token's sibling sessions, listed in the header's picker when
	 * `onSelectSession` is also wired (Phase 4 follow-up). */
	sessions?: BridgeSessionRow[];
	/** The bridge token this session belongs to — drives the header's Settings
	 * dialog (edits the token's persisted config). */
	token?: BridgeTokenRow;
	transport: BridgeTransport;
	/** Dicebear URL for the current user's bubbles; falls back to a role icon
	 * when absent (e.g. the email hasn't loaded yet). */
	userAvatarUrl?: string;
}

interface TerminalBodyProps {
	answerApproval: (requestId: string, optionId: string) => Promise<void>;
	answered: Record<string, string>;
	avatars: ChatAvatars;
	caps: AgentCapabilities;
	disabled: boolean;
	ended: boolean;
	interrupt: () => void;
	onSend: (text: string) => Promise<void>;
	sending: boolean;
	sessionReady: SessionReadyDetail | null;
	setModel: (model: string) => void;
	setPermissionMode: (mode: string) => void;
	turnInFlight: boolean;
	turns: BridgeTurn[];
	turnUsage: TurnUsageDetail | null;
	usageUpdate: UsageUpdateDetail | null;
}

interface BodyComposerProps {
	caps: AgentCapabilities;
	disabled: boolean;
	interrupt: () => void;
	onSend: (text: string) => Promise<void>;
	sending: boolean;
	sessionReady: SessionReadyDetail | null;
	setModel: (model: string) => void;
	setPermissionMode: (mode: string) => void;
	turnInFlight: boolean;
}

/** The composer with its capability-gated control menus fed from the session's
 * reported model/permission values — split out of `TerminalBody` purely to keep
 * that component under the repo's max-lines-per-function gate. */
function BodyComposer({
	caps,
	disabled,
	interrupt,
	onSend,
	sending,
	sessionReady,
	setModel,
	setPermissionMode,
	turnInFlight,
}: BodyComposerProps) {
	return (
		<TerminalComposer
			canInterrupt={caps.interrupt}
			disabled={disabled}
			model={sessionReady?.model}
			models={sessionReady?.models}
			onInterrupt={interrupt}
			onSend={onSend}
			onSetModel={setModel}
			onSetPermissionMode={setPermissionMode}
			permissionMode={sessionReady?.permissionMode}
			permissionModes={caps.permissionModes}
			sending={sending}
			skills={caps.skills ? sessionReady?.skills : undefined}
			slashCommands={
				caps.slashCommands ? sessionReady?.slashCommands : undefined
			}
			turnInFlight={turnInFlight}
		/>
	);
}

/** The feed, the (capability-gated) usage chip, and the composer — split out
 * of `Terminal` purely to keep that component under the repo's
 * max-lines-per-function gate. The composer now carries the model /
 * permission-mode menus and the Stop button (see terminal-composer.tsx). */
function TerminalBody(props: TerminalBodyProps) {
	return (
		<>
			<TerminalFeed
				answerApproval={props.answerApproval}
				answered={props.answered}
				avatars={props.avatars}
				ended={props.ended}
				sending={props.sending}
				turnInFlight={props.turnInFlight}
				turns={props.turns}
			/>
			{props.caps.usageMode === "stream" && (
				<>
					<TurnUsagePanel detail={props.turnUsage} />
					<UsageUpdateLine detail={props.usageUpdate} />
				</>
			)}
			<BodyComposer
				caps={props.caps}
				disabled={props.disabled}
				interrupt={props.interrupt}
				onSend={props.onSend}
				sending={props.sending}
				sessionReady={props.sessionReady}
				setModel={props.setModel}
				setPermissionMode={props.setPermissionMode}
				turnInFlight={props.turnInFlight}
			/>
		</>
	);
}

/** Whether to show the "working" skeleton — derived from the LAST renderable
 * event, tail-first, so it can never get stuck:
 *   - assistant `output` (streaming reply)     → false (the text IS the signal)
 *   - a `message`                              → true only if it's the USER's
 *     (we're waiting for the agent's reply); an assistant message → false
 *   - a `tool` still `started` (no result yet) → true (agent working silently)
 *     — a completed/failed tool → false
 * Status events (turn_usage/turn_end, session_ready, …) are skipped so the
 * scan lands on the real conversational tail. Crucially this does NOT depend on
 * a turn-completion event: opencode/pi/codex never emit `turn_usage`/`turn_end`,
 * so the old "show until completion" logic left the skeleton on forever. */
function deriveTurnInFlight(events: StreamEvent[], ended: boolean): boolean {
	if (ended) {
		return false;
	}
	for (let i = events.length - 1; i >= 0; i--) {
		const event = events[i].event;
		if (event.kind === "output") {
			return false;
		}
		if (event.kind === "message") {
			return event.role === "user";
		}
		if (event.kind === "tool") {
			return event.status === "started";
		}
	}
	return false;
}

/** Wires `useBridgeTerminal` to this session plus the derived turns/avatars —
 * split out purely to keep `Terminal` itself under the repo's
 * max-lines-per-function gate. */
function useTerminalView(
	session: BridgeSessionRow,
	transport: BridgeTransport,
	userAvatarUrl: string | undefined
) {
	const bridge = useBridgeTerminal(
		session.id,
		transport,
		session.status === "ended"
	);
	const ended = session.status === "ended";
	const turns = useMemo(
		() => foldEventsToTurns(bridge.events),
		[bridge.events]
	);
	const turnInFlight = useMemo(
		() => deriveTurnInFlight(bridge.events, ended),
		[bridge.events, ended]
	);
	// Stable across renders so `React.memo`'d rows can skip re-rendering on the
	// many non-event renders (sending flips, connection-status changes): avatars
	// only depends on tokenId + user url, caps only on agentKind.
	const avatars = useMemo<ChatAvatars>(
		() => ({
			assistant: agentAvatar(session.tokenId),
			user: userAvatarUrl,
		}),
		[session.tokenId, userAvatarUrl]
	);
	const caps = useMemo(
		() => capabilities(session.agentKind),
		[session.agentKind]
	);
	const sessionId = bridge.sessionReady?.sessionId ?? session.id;
	return { ...bridge, avatars, caps, sessionId, turns, turnInFlight };
}

/**
 * Live view of one bridge session: header shows connection status, body is
 * the auto-scrolling, ordered/deduped normalized-event feed, footer is the
 * input box that posts via `sendInput`. `transport` is always injected
 * (real one from bridge-transport.ts in the route, a fake in tests) —
 * mirrors `Conversation`'s injected `AgentClient`.
 */
export function Terminal({
	activeSessionId,
	ending = false,
	onEnd,
	onSelectSession,
	session,
	sessions,
	token,
	transport,
	userAvatarUrl,
}: TerminalProps) {
	const view = useTerminalView(session, transport, userAvatarUrl);
	const { caps, sessionId } = view;

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<TerminalHeader
				activeSessionId={activeSessionId ?? session.id}
				agentKind={session.agentKind}
				canSend={view.canSend}
				caps={caps}
				ending={ending}
				listSessions={view.listSessions}
				onEnd={onEnd}
				onSelectSession={onSelectSession}
				sessionId={sessionId}
				sessionList={view.sessionList}
				sessionReady={view.sessionReady}
				sessions={sessions}
				status={view.status}
				token={token}
			/>
			<BodyFromView caps={caps} view={view} />
		</div>
	);
}

type TerminalView = ReturnType<typeof useTerminalView>;

/** The feed + usage + composer, built from the terminal hook's `view` — split
 * out so `Terminal` itself stays under the max-lines-per-function gate. */
function BodyFromView({
	caps,
	view,
}: {
	caps: AgentCapabilities;
	view: TerminalView;
}) {
	return (
		<TerminalBody
			answerApproval={view.answerApproval}
			answered={view.answered}
			avatars={view.avatars}
			caps={caps}
			disabled={!view.canSend}
			ended={view.status === "ended"}
			interrupt={view.interrupt}
			onSend={view.sendInput}
			sending={view.sending}
			sessionReady={view.sessionReady}
			setModel={view.setModel}
			setPermissionMode={view.setPermissionMode}
			turnInFlight={view.turnInFlight}
			turns={view.turns}
			turnUsage={view.turnUsage}
			usageUpdate={view.usageUpdate}
		/>
	);
}
