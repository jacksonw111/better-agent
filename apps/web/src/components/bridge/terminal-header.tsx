import type { BridgeSessionRow } from "@/utils/api-types";
import type { SessionReadyDetail } from "./bridge-session-status";
import { SessionIdLabel } from "./session-id-label";
import { SessionStatusHeader } from "./session-status-header";
import type { TerminalHeaderActionsProps } from "./terminal-header-controls";
import {
	ActionControls,
	TerminalHeaderOverflowMenu,
} from "./terminal-header-overflow-menu";
import { TerminalStatus } from "./terminal-status";

/** The header's right-hand action cluster: the full set of controls at
 * `sm` and up, collapsed into a single "⋯" overflow menu below `sm` (D4;
 * see `terminal-header-overflow-menu.tsx`) — both render the SAME
 * `SessionControls`/`SessionDataActions`/Restart/End components so the two
 * layouts can't drift. Split out purely to keep `TerminalHeader` under the
 * repo's max-lines-per-function gate. */
function TerminalHeaderActions(props: TerminalHeaderActionsProps) {
	return (
		<div className="flex flex-wrap items-center gap-1.5">
			<div className="hidden items-center gap-1.5 sm:flex">
				<ActionControls {...props} />
			</div>
			<TerminalHeaderOverflowMenu {...props} />
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
						<SessionIdLabel
							agentKind={agentKind}
							caps={actions.caps}
							permissionMode={sessionReady?.permissionMode}
							sessionId={sessionId}
						/>
						<TerminalStatus status={status} />
					</div>
					<TerminalHeaderActions {...actions} status={status} />
				</div>
				<SessionStatusHeader detail={sessionReady} />
			</div>
		</div>
	);
}
