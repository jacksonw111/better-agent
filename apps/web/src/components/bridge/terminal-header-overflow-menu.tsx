import { Button } from "@better-agent/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "@better-agent/ui/components/dropdown-menu";
import { EllipsisIcon } from "lucide-react";
import { RestartSessionButton } from "./restart-session-button";
import {
	EndSessionButton,
	SessionControls,
	SessionDataActions,
	type TerminalHeaderActionsProps,
} from "./terminal-header-controls";

/** The action cluster's actual controls, shared verbatim between the `sm`-and-up
 * inline row and the <sm overflow menu below so the two layouts can't drift. */
export function ActionControls({
	activeSessionId,
	canSend,
	caps,
	ending,
	getStatus,
	listSessions,
	onEnd,
	onSelectSession,
	restart,
	sessionList,
	sessions,
	status,
	statusSnapshot,
	token,
	usageUpdate,
}: TerminalHeaderActionsProps) {
	return (
		<>
			<SessionControls
				activeSessionId={activeSessionId}
				onSelectSession={onSelectSession}
				sessions={sessions}
				token={token}
			/>
			<SessionDataActions
				canSend={canSend}
				caps={caps}
				getStatus={getStatus}
				listSessions={listSessions}
				sessionList={sessionList}
				statusSnapshot={statusSnapshot}
				usageUpdate={usageUpdate}
			/>
			{status !== "ended" && <RestartSessionButton restart={restart} />}
			{status !== "ended" && onEnd !== undefined && (
				<EndSessionButton ending={ending} onEnd={onEnd} />
			)}
		</>
	);
}

/** <sm: collapses the terminal header's action cluster (Settings, session
 * picker, Past conversations, Status, Restart, End) into a single "⋯" menu —
 * the connection-status dot and agent-kind label live outside this cluster
 * (session-id-label.tsx) and stay visible regardless (D4 item #5). */
export function TerminalHeaderOverflowMenu(props: TerminalHeaderActionsProps) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						aria-label="More actions"
						className="sm:hidden"
						size="icon-sm"
						variant="ghost"
					/>
				}
			>
				<EllipsisIcon className="size-4" />
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="end"
				className="flex w-64 flex-col items-stretch gap-1 p-2"
			>
				<ActionControls {...props} />
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
