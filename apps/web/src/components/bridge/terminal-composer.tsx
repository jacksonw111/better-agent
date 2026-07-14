import {
	PromptInput,
	type PromptInputComboboxAria,
	PromptInputTextarea,
} from "@better-agent/ui/components/prompt-input";
// React's KeyboardEvent is aliased so `useEscInterrupt`'s document-level
// listener below keeps referring to the DOM global of the same name.
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import { useClientPref } from "@/utils/preferences";
import type { TextWhen } from "./agent-capabilities";
import { BusyInputHint } from "./busy-input-hint";
import { handleCtrlEnterKeyDown } from "./composer-enter-policy";
import { usePermissionModeCycle } from "./permission-mode-cycle";
import { SlashPickerList } from "./slash-picker-list";
import {
	ComposerToolbar,
	resolveToolbarProps,
} from "./terminal-composer-toolbar";
import { useBusySend } from "./use-busy-send";
import { type UseSlashPickerResult, useSlashPicker } from "./use-slash-picker";
import type { WebQueue, WebQueueItem } from "./use-web-queue";
import { WebQueueCards } from "./web-queue-cards";

export interface TerminalComposerProps {
	/** R3-T1: the busy-turn send policies this agent actually supports (see
	 * `SessionCapabilities.busyModes`) — the busy-input hint/picker only
	 * mounts once a turn is in flight AND this has more than the bare "queue"
	 * default (a single mode leaves nothing to pick). */
	busyModes?: TextWhen[];
	/** True while this agent supports mid-turn interruption — controls whether a
	 * Stop button (vs. a disabled Send) is offered while a turn is in flight. */
	canInterrupt?: boolean;
	disabled: boolean;
	/** The session's active model, highlighted in the model menu. */
	model?: string;
	/** The model ids the agent reports (`session_ready.models`); the model menu
	 * lists exactly these and is hidden when empty. */
	models?: string[];
	/** Cancels the in-flight turn — wired to the Stop button. */
	onInterrupt?: () => void;
	/** R3-T1: `when` rides the send only when the user picked something other
	 * than the default "queue" — see `submit()`'s single-vs-two-argument call
	 * below, kept byte-identical to the pre-R3-T1 call for the default case. */
	onSend: (text: string, when?: TextWhen) => void;
	onSetModel?: (model: string) => void;
	onSetPermissionMode?: (mode: string) => void;
	onSetThinking?: (level: string) => void;
	/** The session's active permission mode, highlighted in the mode menu. */
	permissionMode?: string;
	/** The permission-mode values this agent accepts; the mode menu is hidden
	 * when empty. */
	permissionModes?: readonly string[];
	/** R3-T1: pi's queued-message count (see bridge-queue-status.ts) — shown as
	 * a "已排队 N 条" chip next to the busy-input hint when positive. */
	queuedCount?: number | null;
	sending: boolean;
	/** True for a codex session — see `ComposerControlsProps.showNextTurnHint`;
	 * threaded through from `terminal.tsx`, which is the one place that knows
	 * the session's `agentKind`. */
	showNextTurnHint?: boolean;
	/** The session's reported skill names (see `session_ready`'s `skills`) —
	 * `undefined` before the session has reported them, in which case the "/"
	 * picker never opens (there is nothing yet to show). */
	skills?: string[];
	/** The session's reported slash-command names (see `session_ready`'s
	 * `slashCommands`) — same "absent until reported" contract as `skills`. */
	slashCommands?: string[];
	/** pi's `set_thinking_level` vocabulary (see `ComposerControlsProps`'s
	 * `thinkingLevels`); the Thinking menu is hidden when empty/absent. */
	thinkingLevels?: readonly string[];
	/** True from the user's send until the turn completes — swaps Send for Stop
	 * (when `canInterrupt`) so the user can cancel a long-running turn. */
	turnInFlight?: boolean;
	/** P2-T5: the web-side editable busy queue (see use-web-queue.ts). When
	 * present, a busy-turn submit with the default "queue" policy is HELD here
	 * (rendered as editable/deletable cards above the box) instead of being
	 * relayed for native agent-side queueing; absent (unit tests), the old
	 * immediate send applies. */
	webQueue?: WebQueue;
}

/** `aria-activedescendant`/`aria-controls` wiring for the textarea while the
 * picker is open — a bare textarea (no combobox semantics) otherwise. */
function comboboxAriaFor(
	picker: UseSlashPickerResult
): PromptInputComboboxAria | undefined {
	if (!picker.open) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	return {
		activeDescendant: picker.itemDomId(picker.activeIndex),
		controls: picker.listId,
	};
}

interface ComposerBoxProps {
	disabled: boolean;
	hint?: ReactNode;
	onKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => boolean;
	picker: UseSlashPickerResult;
	setText: (text: string) => void;
	submit: () => void;
	text: string;
	toolbar: ReactNode;
}

/** The busy-input hint row (when applicable), the "/" picker (when open)
 * stacked above the prompt input itself — split out of `TerminalComposer`
 * purely to keep that component under the repo's max-lines-per-function
 * gate. */
function ComposerBox({
	disabled,
	hint,
	onKeyDown,
	picker,
	setText,
	submit,
	text,
	toolbar,
}: ComposerBoxProps) {
	return (
		<div className="relative mx-auto max-w-3xl">
			{hint}
			{picker.open && (
				<SlashPickerList
					activeIndex={picker.activeIndex}
					itemDomId={picker.itemDomId}
					items={picker.items}
					listId={picker.listId}
					onHover={picker.setActiveIndex}
					onSelect={picker.select}
				/>
			)}
			<PromptInput
				className="rounded-2xl border bg-background/85 p-2 shadow-lg backdrop-blur-md md:bg-background md:shadow-sm md:backdrop-blur-none"
				onSubmit={submit}
			>
				<PromptInputTextarea
					comboboxAria={comboboxAriaFor(picker)}
					disabled={disabled}
					onChange={setText}
					onKeyDown={onKeyDown}
					onSubmit={submit}
					placeholder={disabled ? "Waiting for connection…" : "Send a message…"}
					value={text}
				/>
				{toolbar}
			</PromptInput>
		</div>
	);
}

/**
 * Bottom input box for a bridge terminal, styled to match the normal chat
 * composer (centered, rounded card). The toolbar's bottom-right cluster carries
 * the agent's own control menus ([model] [permission mode] — see
 * `ComposerControls`) followed by Send, which swaps to Stop while an
 * interruptible turn is in flight. Posts via `onSend` and clears; the guard
 * keeps a send from firing while disabled or in flight.
 *
 * Typing "/" at the start of an empty box opens a command/skill picker (see
 * `use-slash-picker.ts`) fed by the session's own reported capabilities.
 * Selecting an item only fills the box (`/name `); sending still goes through
 * the same `onSend` path as any other line.
 */
/** True only once a turn is actually in flight AND the agent supports more
 * than the bare default — with a single busy mode there's nothing to pick,
 * so the hint/dropdown would just be noise. Split out purely to keep
 * `TerminalComposer` itself under the repo's cyclomatic-complexity gate. */
function shouldShowBusyHint(props: TerminalComposerProps): boolean {
	return (props.turnInFlight ?? false) && (props.busyModes?.length ?? 0) > 1;
}

/** P1-T5: Esc cancels an interruptible in-flight turn — keyboard parity with
 * the toolbar's Stop button. Document-level so the composer needn't hold
 * focus; inert for presses something else already handled (an open picker's
 * own Esc arrives defaultPrevented) and for modified keys. */
function useEscInterrupt(props: TerminalComposerProps): void {
	const { canInterrupt, onInterrupt, turnInFlight } = props;
	const enabled = (turnInFlight ?? false) && (canInterrupt ?? false);
	useEffect(() => {
		if (!(enabled && onInterrupt)) {
			return () => {
				// nothing to clean up: no listener was attached
			};
		}
		const onKeyDown = (keyEvent: KeyboardEvent) => {
			const modified = keyEvent.metaKey || keyEvent.ctrlKey || keyEvent.altKey;
			if (keyEvent.key !== "Escape" || keyEvent.defaultPrevented || modified) {
				return;
			}
			onInterrupt();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [enabled, onInterrupt]);
}

/** The web queue's cards plus the busy-input hint row, stacked in that order
 * above the box — split out of `TerminalComposer` purely to keep it under the
 * repo's max-lines-per-function gate. "Edit" loads the card's text back into
 * the composer (replacing the current draft) and removes the card. */
function composerHint(
	props: TerminalComposerProps,
	busySend: { setWhen: (when: TextWhen) => void; when: TextWhen },
	setText: (text: string) => void
): ReactNode {
	const onEdit = (item: WebQueueItem) => {
		setText(item.text);
		props.webQueue?.remove(item.id);
	};
	return (
		<>
			{props.webQueue && (
				<WebQueueCards
					items={props.webQueue.items}
					onEdit={onEdit}
					onRemove={(id) => props.webQueue?.remove(id)}
				/>
			)}
			{shouldShowBusyHint(props) && (
				<BusyInputHint
					busyModes={props.busyModes ?? []}
					onWhenChange={busySend.setWhen}
					queuedCount={props.queuedCount}
					when={busySend.when}
				/>
			)}
		</>
	);
}

export function TerminalComposer(props: TerminalComposerProps) {
	const { disabled } = props;
	const [text, setText] = useState("");
	const picker = useSlashPicker({
		commands: props.slashCommands,
		setText,
		skills: props.skills,
		text,
	});
	const { setWhen, submit, when } = useBusySend(props, text, setText);
	useEscInterrupt(props);
	const sendByCtrlEnter = useClientPref("sendByCtrlEnter");
	const handleTabCycle = usePermissionModeCycle({
		onSetPermissionMode: props.onSetPermissionMode ?? (() => undefined),
		permissionMode: props.permissionMode,
		permissionModes: props.permissionModes,
		pickerOpen: picker.open,
	});
	// Chain order: an open "/" picker owns the keyboard, then Tab-cycles the
	// permission mode (P2-T5), then the Ctrl+Enter send policy (P2-T4).
	const onComposerKeyDown = (
		event: ReactKeyboardEvent<HTMLTextAreaElement>
	): boolean =>
		picker.handleKeyDown(event) ||
		handleTabCycle(event) ||
		handleCtrlEnterKeyDown(event, sendByCtrlEnter, submit);

	const toolbar = <ComposerToolbar {...resolveToolbarProps(props, text)} />;
	const hint = composerHint(props, { setWhen, when }, setText);

	// Keep this wrapper's classes AND the inner PromptInput's classes in sync
	// with their twin in packages/ui/src/components/chat/chat-composer.tsx
	// (ChatComposer) — the two composers are styled to match. On <md the box
	// floats as a glass pill (shadow-lg + backdrop-blur, matching the dock) and
	// `pb-safe-composer` clears the home indicator; desktop keeps the solid card.
	return (
		<div className="mx-auto w-full max-w-3xl shrink-0 px-3 pb-safe-composer sm:px-4 md:pb-4">
			<ComposerBox
				disabled={disabled}
				hint={hint}
				onKeyDown={onComposerKeyDown}
				picker={picker}
				setText={setText}
				submit={submit}
				text={text}
				toolbar={toolbar}
			/>
		</div>
	);
}
