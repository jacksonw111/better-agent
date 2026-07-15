import type { ChatAvatars } from "@better-agent/ui/components/chat/chat-row";
import { useMemo } from "react";
import type { BridgeSessionRow, BridgeTokenRow } from "@/utils/api-types";
import { agentAvatar } from "@/utils/avatar";
import type { StreamEvent } from "./bridge-events";
import type { BridgeTransport } from "./bridge-transport";
import {
	type ResolvedCapabilities,
	resolveCapabilities,
} from "./resolve-capabilities";
import { TerminalBody } from "./terminal-body";
import { TerminalHeader } from "./terminal-header";
import { useBridgeTerminal } from "./use-bridge-terminal";
import { useFoldedTurns } from "./use-folded-turns";
import { usePublishFsChannel } from "./use-fs-channel";
import { usePublishShellChannel } from "./use-shell-channel";
import { useWebQueue } from "./use-web-queue";

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
	const turns = useFoldedTurns(bridge.events);
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
		() => resolveCapabilities(session.agentKind, bridge.sessionReady),
		[session.agentKind, bridge.sessionReady]
	);
	// P2-T5: the web-side editable busy queue — keyed by the session ROW id
	// (session.id, stable for the session's whole life), NOT the derived
	// `sessionId` below, which flips once `session_ready` reports the agent's
	// own id and would spuriously trip the queue's "session switched" drop.
	const webQueue = useWebQueue({
		ended,
		send: bridge.sendInput,
		sessionId: session.id,
		turnInFlight,
	});
	const sessionId = bridge.sessionReady?.sessionId ?? session.id;
	// P3-T2: the composer's per-session image upload — present only when the
	// transport can upload; the capability gate (caps.images) applies in
	// TerminalBody so a fake transport in tests can still opt out.
	const { uploadAttachment } = transport;
	const imageUpload = uploadAttachment
		? (file: File) => uploadAttachment({ file, sessionId: session.id })
		: undefined;
	return {
		...bridge,
		avatars,
		caps,
		imageUpload,
		sessionId,
		turns,
		turnInFlight,
		webQueue,
	};
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
	// P4-T2: publish this session's shell channel (feed's runShell events + the
	// runShell control) to the module store the workspace Shell tab reads —
	// avoids a second SSE connection for the pane.
	usePublishShellChannel(view.events, caps.shell, view.runShell);
	// P4-T3: likewise for the fs channel (Files tab + composer @file picker) —
	// requestId-correlated fsList/fsRead over the same feed, see use-fs-channel.ts.
	usePublishFsChannel(view.events, caps.fs, {
		list: view.fsList,
		read: view.fsRead,
	});

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<TerminalHeader
				activeSessionId={activeSessionId ?? session.id}
				agentKind={session.agentKind}
				canSend={view.canSend}
				caps={caps}
				ending={ending}
				getStatus={view.getStatus}
				listSessions={view.listSessions}
				onEnd={onEnd}
				onSelectSession={onSelectSession}
				restart={view.restart}
				sessionId={sessionId}
				sessionList={view.sessionList}
				sessionReady={view.sessionReady}
				sessions={sessions}
				status={view.status}
				statusSnapshot={view.statusSnapshot}
				token={token}
				usageUpdate={view.usageUpdate}
			/>
			<BodyFromView
				caps={caps}
				showNextTurnHint={session.agentKind === "codex"}
				view={view}
			/>
		</div>
	);
}

type TerminalView = ReturnType<typeof useTerminalView>;

/** The feed + usage + composer, built from the terminal hook's `view` — split
 * out so `Terminal` itself stays under the max-lines-per-function gate.
 * `showNextTurnHint` is codex-only (R2-T2's per-turn `setModel`/
 * `setPermissionMode` semantics) — computed here from `session.agentKind`,
 * the one place in the composer chain that actually has the session row. */
function BodyFromView({
	caps,
	showNextTurnHint,
	view,
}: {
	caps: ResolvedCapabilities;
	showNextTurnHint: boolean;
	view: TerminalView;
}) {
	return (
		<TerminalBody
			answerApproval={view.answerApproval}
			answered={view.answered}
			answeredQuestions={view.answeredQuestions}
			answerQuestion={view.answerQuestion}
			avatars={view.avatars}
			caps={caps}
			commandCatalog={view.commandCatalog}
			disabled={!view.canSend}
			ended={view.status === "ended"}
			getStatus={view.getStatus}
			imageUpload={view.imageUpload}
			interrupt={view.interrupt}
			onSend={view.sendInput}
			queueUpdate={view.queueUpdate}
			sending={view.sending}
			sessionReady={view.sessionReady}
			setModel={view.setModel}
			setPermissionMode={view.setPermissionMode}
			setThinking={view.setThinking}
			showNextTurnHint={showNextTurnHint}
			statusSnapshot={view.statusSnapshot}
			turnInFlight={view.turnInFlight}
			turns={view.turns}
			turnUsage={view.turnUsage}
			usageUpdate={view.usageUpdate}
			webQueue={view.webQueue}
		/>
	);
}
