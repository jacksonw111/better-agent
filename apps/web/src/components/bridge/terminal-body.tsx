import type { ChatAvatars } from "@better-agent/ui/components/chat/chat-row";
import type { ResolvedCapabilities, TextWhen } from "./agent-capabilities";
import type { CommandCatalogDetail } from "./bridge-command-catalog";
import type { QueueUpdateDetail } from "./bridge-queue-status";
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
	answeredQuestions: Record<string, string[][]>;
	/** R3-T3: mirrors `answerApproval`/`answered` for a `question` turn. */
	answerQuestion: (requestId: string, answers: string[][]) => Promise<void>;
	avatars: ChatAvatars;
	caps: ResolvedCapabilities;
	/** The latest `command_catalog` detail (R5-T2) — feeds the "/" picker's
	 * "Commands" group; see `BodyComposer`'s fallback to
	 * `sessionReady.slashCommands` for adapters that don't emit this yet. */
	commandCatalog: CommandCatalogDetail | null;
	disabled: boolean;
	ended: boolean;
	interrupt: () => void;
	onSend: (text: string, when?: TextWhen) => Promise<void>;
	/** R3-T1: pi's queued-message count, or `null` before one has arrived — see
	 * bridge-queue-status.ts. */
	queueUpdate: QueueUpdateDetail | null;
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
	commandCatalog: CommandCatalogDetail | null;
	disabled: boolean;
	interrupt: () => void;
	onSend: (text: string, when?: TextWhen) => Promise<void>;
	queueUpdate: QueueUpdateDetail | null;
	sending: boolean;
	sessionReady: SessionReadyDetail | null;
	setModel: (model: string) => void;
	setPermissionMode: (mode: string) => void;
	setThinking: (level: string) => void;
	showNextTurnHint: boolean;
	turnInFlight: boolean;
}

/** The "/" picker's command names: the live `command_catalog` (R5-T1/R5-T2)
 * wins once an adapter has pushed one (claude-code/pi/opencode-serve), since
 * it's richer and stays current across mid-session changes; ACP opencode
 * never emits a catalog, so its `session_ready.slashCommands` (folded in at
 * normalize time — see `normalizeAcpAvailableCommands`) is kept as the
 * fallback rather than going dark. `undefined` (not `[]`) means "nothing
 * reported yet", same contract `slashCommands` already had — the picker
 * simply won't open. */
function commandNamesFor(
	commandCatalog: CommandCatalogDetail | null,
	sessionReady: SessionReadyDetail | null
): string[] | undefined {
	if (commandCatalog) {
		return commandCatalog.commands.map((command) => command.name);
	}
	return sessionReady?.slashCommands;
}

/** The composer with its capability-gated control menus fed from the session's
 * reported model/permission values — split out of `TerminalBody` purely to keep
 * that component under the repo's max-lines-per-function gate. */
function BodyComposer({
	caps,
	commandCatalog,
	disabled,
	interrupt,
	onSend,
	queueUpdate,
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
			busyModes={caps.busyModes}
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
			queuedCount={queueUpdate?.queuedCount}
			sending={sending}
			showNextTurnHint={showNextTurnHint}
			skills={caps.skills ? sessionReady?.skills : undefined}
			slashCommands={
				caps.slashCommands
					? commandNamesFor(commandCatalog, sessionReady)
					: undefined
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
				answeredQuestions={props.answeredQuestions}
				answerQuestion={props.answerQuestion}
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
				commandCatalog={props.commandCatalog}
				disabled={props.disabled}
				interrupt={props.interrupt}
				onSend={props.onSend}
				queueUpdate={props.queueUpdate}
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
