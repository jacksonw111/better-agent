import {
	PromptInput,
	type PromptInputComboboxAria,
	PromptInputTextarea,
} from "@better-agent/ui/components/prompt-input";
import type { ReactNode } from "react";
import { useState } from "react";
import { SlashPickerList } from "./slash-picker-list";
import {
	ComposerToolbar,
	resolveToolbarProps,
} from "./terminal-composer-toolbar";
import { type UseSlashPickerResult, useSlashPicker } from "./use-slash-picker";

export interface TerminalComposerProps {
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
	onSend: (text: string) => void;
	onSetModel?: (model: string) => void;
	onSetPermissionMode?: (mode: string) => void;
	onSetThinking?: (level: string) => void;
	/** The session's active permission mode, highlighted in the mode menu. */
	permissionMode?: string;
	/** The permission-mode values this agent accepts; the mode menu is hidden
	 * when empty. */
	permissionModes?: readonly string[];
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
	picker: UseSlashPickerResult;
	setText: (text: string) => void;
	submit: () => void;
	text: string;
	toolbar: ReactNode;
}

/** The "/" picker (when open) stacked above the prompt input itself — split
 * out of `TerminalComposer` purely to keep that component under the repo's
 * max-lines-per-function gate. */
function ComposerBox({
	disabled,
	picker,
	setText,
	submit,
	text,
	toolbar,
}: ComposerBoxProps) {
	return (
		<div className="relative w-full">
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
				className="rounded-2xl border bg-background p-2 shadow-sm"
				onSubmit={submit}
			>
				<PromptInputTextarea
					comboboxAria={comboboxAriaFor(picker)}
					disabled={disabled}
					onChange={setText}
					onKeyDown={picker.handleKeyDown}
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
export function TerminalComposer(props: TerminalComposerProps) {
	const { disabled, sending } = props;
	const [text, setText] = useState("");
	const picker = useSlashPicker({
		commands: props.slashCommands,
		setText,
		skills: props.skills,
		text,
	});

	const submit = () => {
		const trimmed = text.trim();
		if (trimmed === "" || disabled || sending) {
			return;
		}
		props.onSend(trimmed);
		setText("");
	};

	const toolbar = <ComposerToolbar {...resolveToolbarProps(props, text)} />;

	return (
		<div className="mx-auto w-full max-w-3xl shrink-0 px-3 py-3 sm:px-4">
			<ComposerBox
				disabled={disabled}
				picker={picker}
				setText={setText}
				submit={submit}
				text={text}
				toolbar={toolbar}
			/>
		</div>
	);
}
