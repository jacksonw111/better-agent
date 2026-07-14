import type { KeyboardEvent } from "react";
import { useId, useState } from "react";
import {
	applySlashPickerSelection,
	buildSlashPickerItems,
	clampActiveIndex,
	parseSlashQuery,
	type SlashPickerItem,
	type SlashPickerSource,
} from "./slash-picker";
import { readSlashUsage, recordSlashUsage } from "./slash-usage";

export interface UseSlashPickerArgs extends SlashPickerSource {
	setText: (text: string) => void;
	text: string;
}

export interface UseSlashPickerResult {
	activeIndex: number;
	handleKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
	itemDomId: (index: number) => string;
	items: SlashPickerItem[];
	listId: string;
	open: boolean;
	select: (item: SlashPickerItem) => void;
	setActiveIndex: (index: number) => void;
}

/** Builds the filtered item list for the composer's current text against the
 * session's reported commands/skills, resetting the active row to the top
 * whenever the query itself changes — a fresh filter should never keep a
 * stale highlight from a longer/shorter query. Adjusts state during render
 * (the react.dev-documented pattern for "reset state when a prop/derived
 * value changes") rather than an effect, since the reset has no other
 * side effect to run and doing it in an effect would paint one extra,
 * stale frame first. Split out of the hook below purely to keep it under
 * the repo's max-lines-per-function gate. */
function useSlashPickerItems(
	text: string,
	commands: string[] | undefined,
	skills: string[] | undefined
) {
	const parsed = parseSlashQuery(text);
	const query = parsed?.query ?? null;
	// P2-T5: usage counts re-read per keystroke (a tiny localStorage blob) so
	// the sort always reflects the latest picks; a selection closes the picker
	// (the inserted trailing space ends the query), so the order never
	// reshuffles under an open list.
	const items =
		parsed === null
			? []
			: buildSlashPickerItems(
					{ commands, skills },
					parsed.query,
					readSlashUsage()
				);
	const [activeIndex, setActiveIndex] = useState(0);
	const [seenQuery, setSeenQuery] = useState(query);
	if (query !== seenQuery) {
		setSeenQuery(query);
		setActiveIndex(0);
	}
	return { items, activeIndex, setActiveIndex };
}

interface HandleSlashPickerKeyDownArgs {
	activeIndex: number;
	event: KeyboardEvent<HTMLTextAreaElement>;
	items: SlashPickerItem[];
	open: boolean;
	select: (item: SlashPickerItem) => void;
	setActiveIndex: (index: number) => void;
	setText: (text: string) => void;
}

/** The picker's keyboard-nav keys — arrow keys move the highlight, Enter
 * fills the composer with the highlighted item, Escape clears the
 * in-progress slash entry — as a plain function (rather than inline in the
 * hook below) purely to keep `useSlashPicker` under the repo's
 * max-lines-per-function gate. Returns whether the key was consumed, so the
 * shared textarea's own Enter-to-submit/newline handling is skipped when it
 * was. */
function handleSlashPickerKeyDown({
	activeIndex,
	event,
	items,
	open,
	select,
	setActiveIndex,
	setText,
}: HandleSlashPickerKeyDownArgs): boolean {
	if (!open) {
		return false;
	}
	if (event.key === "ArrowDown") {
		event.preventDefault();
		setActiveIndex(clampActiveIndex(activeIndex + 1, items.length));
		return true;
	}
	if (event.key === "ArrowUp") {
		event.preventDefault();
		setActiveIndex(clampActiveIndex(activeIndex - 1, items.length));
		return true;
	}
	if (event.key === "Enter") {
		event.preventDefault();
		const item = items[clampActiveIndex(activeIndex, items.length)];
		if (item) {
			select(item);
		}
		return true;
	}
	if (event.key === "Escape") {
		event.preventDefault();
		setText("");
		return true;
	}
	return false;
}

/**
 * Drives the composer's slash-command/skills picker: derives the filtered
 * list from the composer's own text (a leading, space-free "/query"), and
 * handles the keyboard-nav keys the textarea forwards it (see
 * `PromptInputTextarea`'s `onKeyDown` escape hatch). Selecting only INSERTS
 * the command text (`/name `); sending still goes through the normal submit
 * path, so an arg-taking command can have its arguments typed first.
 */
export function useSlashPicker({
	text,
	setText,
	commands,
	skills,
}: UseSlashPickerArgs): UseSlashPickerResult {
	const listId = useId();
	const { items, activeIndex, setActiveIndex } = useSlashPickerItems(
		text,
		commands,
		skills
	);
	const open = items.length > 0;

	const select = (item: SlashPickerItem) => {
		// P2-T5: a SELECTION (Enter or click on a picker row) is what counts as
		// "using" an item for the frequency sort — typing a full name by hand
		// deliberately doesn't bump it.
		recordSlashUsage(item.name);
		const prefix = parseSlashQuery(text)?.prefix ?? "";
		setText(applySlashPickerSelection(item, prefix));
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): boolean =>
		handleSlashPickerKeyDown({
			activeIndex,
			event,
			items,
			open,
			select,
			setActiveIndex,
			setText,
		});

	return {
		activeIndex,
		handleKeyDown,
		items,
		itemDomId: (index: number) => `${listId}-item-${index}`,
		listId,
		open,
		select,
		setActiveIndex,
	};
}
