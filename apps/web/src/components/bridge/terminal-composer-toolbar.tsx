import { Button } from "@better-agent/ui/components/button";
import {
	PromptInputToolbar,
	PromptInputTools,
} from "@better-agent/ui/components/prompt-input";
import { ArrowUpIcon, SquareIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { TerminalComposerProps } from "./terminal-composer";
import { ComposerControls } from "./terminal-controls";
import type { ImageAttachments } from "./use-image-attachments";

// The composer's bottom-right toolbar (menus + Send/Stop) plus the prop
// resolution that feeds it — split out of terminal-composer.tsx purely to
// keep that file under the repo's max-lines-per-file gate.

const NOOP = () => undefined;
const NO_MODES: readonly string[] = [];

export interface ComposerToolbarProps {
	canStop: boolean;
	controlsDisabled: boolean;
	/** The toolbar's left tools: the P3-T2 paperclip (when the session's image
	 * capability is on) and the P5-2 mic (when the browser supports speech). */
	leftTools?: ReactNode;
	model?: string;
	models?: string[];
	onInterrupt: () => void;
	onSetModel: (model: string) => void;
	onSetPermissionMode: (mode: string) => void;
	onSetThinking: (level: string) => void;
	permissionMode?: string;
	permissionModes: readonly string[];
	sendDisabled: boolean;
	showNextTurnHint: boolean;
	thinkingLevels: readonly string[];
}

/** Send — or Stop, while a turn is interruptibly in flight. */
function SendOrStopButton({
	canStop,
	onInterrupt,
	sendDisabled,
}: {
	canStop: boolean;
	onInterrupt: () => void;
	sendDisabled: boolean;
}) {
	if (canStop) {
		return (
			<Button
				aria-label="Stop"
				onClick={onInterrupt}
				size="icon-sm"
				title="Stop (esc)"
				type="button"
				variant="destructive"
			>
				<SquareIcon className="size-3.5" />
			</Button>
		);
	}
	return (
		<Button
			aria-label="Send"
			disabled={sendDisabled}
			size="icon-sm"
			type="submit"
		>
			<ArrowUpIcon className="size-4" />
		</Button>
	);
}

/** The composer's bottom bar: everything sits bottom-RIGHT next to each other —
 * the agent-reported control menus ([model] [permission]) then Send/Stop — with
 * an empty spacer on the left so the toolbar's `justify-between` pushes the
 * cluster to the right. Split out of `TerminalComposer` to keep it under the
 * max-lines-per-function gate. */
export function ComposerToolbar({
	canStop,
	controlsDisabled,
	leftTools,
	model,
	models,
	onInterrupt,
	onSetModel,
	onSetPermissionMode,
	onSetThinking,
	permissionMode,
	permissionModes,
	sendDisabled,
	showNextTurnHint,
	thinkingLevels,
}: ComposerToolbarProps) {
	return (
		<PromptInputToolbar>
			<div aria-hidden={leftTools ? undefined : "true"}>{leftTools}</div>
			<PromptInputTools>
				<ComposerControls
					disabled={controlsDisabled}
					model={model}
					models={models}
					onSetModel={onSetModel}
					onSetPermissionMode={onSetPermissionMode}
					onSetThinking={onSetThinking}
					permissionMode={permissionMode}
					permissionModes={permissionModes}
					showNextTurnHint={showNextTurnHint}
					thinkingLevels={thinkingLevels}
				/>
				<SendOrStopButton
					canStop={canStop}
					onInterrupt={onInterrupt}
					sendDisabled={sendDisabled}
				/>
			</PromptInputTools>
		</PromptInputToolbar>
	);
}

/** True only once the user has both sent (turnInFlight) AND the agent
 * supports mid-turn cancellation (canInterrupt) — split out of
 * `resolveToolbarProps` purely to keep that function's own cyclomatic
 * complexity under the repo's gate. */
function computeCanStop(props: TerminalComposerProps): boolean {
	return (props.turnInFlight ?? false) && (props.canInterrupt ?? false);
}

/** Send is disabled while the composer itself is disabled, a send is already
 * in flight, an image upload is still in flight, or there's nothing to send
 * (blank draft AND no attached images) — split out for the same
 * complexity-budget reason as `computeCanStop`. */
function computeSendDisabled(
	disabled: boolean,
	sending: boolean,
	text: string,
	images?: ImageAttachments
) {
	if (disabled || sending || (images?.uploading ?? false)) {
		return true;
	}
	return text.trim() === "" && (images?.pending.length ?? 0) === 0;
}

/** Resolves the toolbar's props from the composer's own (mostly-optional)
 * props plus the live draft text — split out purely to keep `TerminalComposer`
 * itself under the repo's cyclomatic-complexity gate (the `??` fallbacks for
 * every optional control callback/value add up fast in one function). */
export function resolveToolbarProps(
	props: TerminalComposerProps,
	text: string,
	images?: ImageAttachments
): ComposerToolbarProps {
	const { disabled, sending } = props;
	return {
		canStop: computeCanStop(props),
		controlsDisabled: disabled,
		model: props.model,
		models: props.models,
		onInterrupt: props.onInterrupt ?? NOOP,
		onSetModel: props.onSetModel ?? NOOP,
		onSetPermissionMode: props.onSetPermissionMode ?? NOOP,
		onSetThinking: props.onSetThinking ?? NOOP,
		permissionMode: props.permissionMode,
		permissionModes: props.permissionModes ?? NO_MODES,
		sendDisabled: computeSendDisabled(disabled, sending, text, images),
		showNextTurnHint: props.showNextTurnHint ?? false,
		thinkingLevels: props.thinkingLevels ?? NO_MODES,
	};
}
