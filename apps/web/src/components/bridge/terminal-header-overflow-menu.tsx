import { Button } from "@better-agent/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "@better-agent/ui/components/dropdown-menu";
import { EllipsisIcon } from "lucide-react";
import { useState } from "react";
import { LocalAgentSettingsDialog } from "./local-agent-settings-dialog";
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
	hidePastConversations,
	hideStatusButton,
	listSessions,
	onEnd,
	onSelectSession,
	onSettingsOpenChange,
	restart,
	sessionList,
	sessions,
	settingsOpen,
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
				onSettingsOpenChange={onSettingsOpenChange}
				sessions={sessions}
				settingsOpen={settingsOpen}
				token={token}
			/>
			<SessionDataActions
				canSend={canSend}
				caps={caps}
				getStatus={getStatus}
				hidePastConversations={hidePastConversations}
				hideStatusButton={hideStatusButton}
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
	// Owned HERE — sibling of the DropdownMenu, not inside its content — so the
	// Settings dialog survives Base UI unmounting `DropdownMenuContent` once
	// the menu closes (which it does as soon as the dialog's modal grabs
	// focus). The menu item below only flips this flag; it never renders the
	// dialog itself (D4 fix — see terminal-header-controls.tsx's
	// `SessionControls`, which mirrors desktop's uncontrolled/self-contained
	// rendering when this isn't passed down).
	const [settingsOpen, setSettingsOpen] = useState(false);
	return (
		<>
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
					<ActionControls
						{...props}
						onSettingsOpenChange={setSettingsOpen}
						settingsOpen={settingsOpen}
					/>
				</DropdownMenuContent>
			</DropdownMenu>
			{props.token && settingsOpen && (
				<LocalAgentSettingsDialog
					onOpenChange={setSettingsOpen}
					open={settingsOpen}
					sessionId={props.activeSessionId ?? undefined}
					token={props.token}
				/>
			)}
		</>
	);
}
