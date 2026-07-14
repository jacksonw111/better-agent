import type { KeyboardEvent } from "react";

/** P2-T4: the `sendByCtrlEnter` pref's keydown layer, LOCAL composer only
 * (the shared `PromptInputTextarea` keeps its Enter-to-submit for cloud
 * chat). With the pref on: Ctrl/Cmd+Enter submits; a plain Enter is reported
 * handled WITHOUT preventDefault, so the shared Enter-to-submit is skipped
 * and the browser's native newline insertion runs instead. Runs AFTER the
 * slash picker's handler (see `TerminalComposer`'s `onComposerKeyDown`), so
 * an open picker's Enter-to-select keeps precedence. */
export function handleCtrlEnterKeyDown(
	event: KeyboardEvent<HTMLTextAreaElement>,
	enabled: boolean,
	submit: () => void
): boolean {
	if (!enabled || event.key !== "Enter") {
		return false;
	}
	if (event.ctrlKey || event.metaKey) {
		event.preventDefault();
		submit();
	}
	return true;
}
