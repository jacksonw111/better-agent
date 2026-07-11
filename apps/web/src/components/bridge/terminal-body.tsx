import type { ChatAvatars } from "@better-agent/ui/components/chat/chat-row";
import type { ResolvedCapabilities } from "./agent-capabilities";
import type {
	SessionReadyDetail,
	TurnUsageDetail,
	UsageUpdateDetail,
} from "./bridge-session-status";
import type { BridgeTurn } from "./bridge-turns";
import { TerminalComposer } from "./terminal-composer";
import { TerminalFeed } from "./terminal-feed";
import { TurnUsagePanel } from "./turn-usage-panel";
import { UsageUpdateLine } from "./usage-update-line";

// `Terminal`'s body — feed, (capability-gated) usage chip, and composer —
// split out of terminal.tsx purely to keep that file under the repo's
// max-lines-per-file gate.

export interface TerminalBodyProps {
	answerApproval: (requestId: string, optionId: string) => Promise<void>;
	answered: Record<string, string>;
	avatars: ChatAvatars;
	caps: ResolvedCapabilities;
	disabled: boolean;
	ended: boolean;
	interrupt: () => void;
	onSend: (text: string) => Promise<void>;
	sending: boolean;
	sessionReady: SessionReadyDetail | null;
	setModel: (model: string) => void;
	setPermissionMode: (mode: string) => void;
	setThinking: (level: string) => void;
	/** True for a codex session — see `ComposerControlsProps.showNextTurnHint`. */
	showNextTurnHint: boolean;
	turnInFlight: boolean;
	turns: BridgeTurn[];
	turnUsage: TurnUsageDetail | null;
	usageUpdate: UsageUpdateDetail | null;
}

interface BodyComposerProps {
	caps: ResolvedCapabilities;
	disabled: boolean;
	interrupt: () => void;
	onSend: (text: string) => Promise<void>;
	sending: boolean;
	sessionReady: SessionReadyDetail | null;
	setModel: (model: string) => void;
	setPermissionMode: (mode: string) => void;
	setThinking: (level: string) => void;
	showNextTurnHint: boolean;
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
	setThinking,
	showNextTurnHint,
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
			onSetThinking={setThinking}
			permissionMode={sessionReady?.permissionMode}
			permissionModes={caps.permissionModes}
			sending={sending}
			showNextTurnHint={showNextTurnHint}
			skills={caps.skills ? sessionReady?.skills : undefined}
			slashCommands={
				caps.slashCommands ? sessionReady?.slashCommands : undefined
			}
			thinkingLevels={caps.thinkingLevels}
			turnInFlight={turnInFlight}
		/>
	);
}

/** The feed, the (capability-gated) usage chip, and the composer — split out
 * of `Terminal` purely to keep that component under the repo's
 * max-lines-per-function gate. The composer now carries the model /
 * permission-mode menus and the Stop button (see terminal-composer.tsx). */
export function TerminalBody(props: TerminalBodyProps) {
	return (
		<>
			<TerminalFeed
				answerApproval={props.answerApproval}
				answered={props.answered}
				avatars={props.avatars}
				ended={props.ended}
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
				setThinking={props.setThinking}
				showNextTurnHint={props.showNextTurnHint}
				turnInFlight={props.turnInFlight}
			/>
		</>
	);
}
