import type { KeyboardEvent } from "react";
import { useId, useState } from "react";
import {
	applySkillPickerSelection,
	clampSkillPickerIndex,
	filterSkillPickerItems,
	parseSkillQuery,
	type SkillPickerItem,
} from "./skill-picker";

export interface UseSkillPickerArgs {
	setText: (text: string) => void;
	skills?: SkillPickerItem[];
	text: string;
}

export interface UseSkillPickerResult {
	activeIndex: number;
	handleKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
	itemDomId: (index: number) => string;
	items: SkillPickerItem[];
	listId: string;
	open: boolean;
	select: (item: SkillPickerItem) => void;
	setActiveIndex: (index: number) => void;
}

/** Builds the filtered item list for the composer's current text against the
 * agent's assigned skills, resetting the active row to the top whenever the
 * query itself changes — a fresh filter should never keep a stale highlight
 * from a longer/shorter query. Adjusts state during render (the react.dev
 * pattern for "reset state when a derived value changes") rather than an
 * effect, same as the bridge terminal's useSlashPickerItems. An agent with no
 * assigned skills (`skills` undefined) never produces items, so the picker
 * never opens. Split out purely to keep `useSkillPicker` under the repo's
 * max-lines-per-function gate. */
function useSkillPickerItems(
	text: string,
	skills: SkillPickerItem[] | undefined
) {
	const query = parseSkillQuery(text);
	const items =
		query === null || skills === undefined
			? []
			: filterSkillPickerItems(skills, query);
	const [activeIndex, setActiveIndex] = useState(0);
	const [seenQuery, setSeenQuery] = useState(query);
	if (query !== seenQuery) {
		setSeenQuery(query);
		setActiveIndex(0);
	}
	return { items, activeIndex, setActiveIndex };
}

interface HandleSkillPickerKeyDownArgs {
	activeIndex: number;
	event: KeyboardEvent<HTMLTextAreaElement>;
	items: SkillPickerItem[];
	open: boolean;
	select: (item: SkillPickerItem) => void;
	setActiveIndex: (index: number) => void;
	setText: (text: string) => void;
}

/** The picker's keyboard-nav keys — arrow keys move the highlight, Enter
 * fills the composer with the highlighted item, Escape clears the
 * in-progress slash entry — as a plain function (rather than inline in the
 * hook below) purely to keep `useSkillPicker` under the repo's
 * max-lines-per-function gate. Returns whether the key was consumed, so the
 * shared textarea's own Enter-to-submit/newline handling is skipped when it
 * was. Mirrors handleSlashPickerKeyDown in the bridge terminal's picker. */
function handleSkillPickerKeyDown({
	activeIndex,
	event,
	items,
	open,
	select,
	setActiveIndex,
	setText,
}: HandleSkillPickerKeyDownArgs): boolean {
	if (!open) {
		return false;
	}
	if (event.key === "ArrowDown") {
		event.preventDefault();
		setActiveIndex(clampSkillPickerIndex(activeIndex + 1, items.length));
		return true;
	}
	if (event.key === "ArrowUp") {
		event.preventDefault();
		setActiveIndex(clampSkillPickerIndex(activeIndex - 1, items.length));
		return true;
	}
	if (event.key === "Enter") {
		event.preventDefault();
		const item = items[clampSkillPickerIndex(activeIndex, items.length)];
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
 * Drives the web chat composer's "/" skill picker: typing a leading "/" at
 * the start of the message opens a dropdown of the agent's assigned skills
 * (name + one-line description — see `SkillPickerList`), filtered as the
 * user keeps typing, and handles the keyboard-nav keys the textarea forwards
 * it (see `PromptInputTextarea`'s `onKeyDown` escape hatch). Selecting only
 * INSERTS the skill invocation text (`/name `); sending still goes through
 * the normal submit path, so a skill's arguments can be typed first. Mirrors
 * the bridge terminal's useSlashPicker (apps/web/src/components/bridge/
 * use-slash-picker.ts), narrowed to skills-only and a leading-slash trigger.
 */
export function useSkillPicker({
	text,
	setText,
	skills,
}: UseSkillPickerArgs): UseSkillPickerResult {
	const listId = useId();
	const { items, activeIndex, setActiveIndex } = useSkillPickerItems(
		text,
		skills
	);
	const open = items.length > 0;

	const select = (item: SkillPickerItem) => {
		setText(applySkillPickerSelection(item));
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): boolean =>
		handleSkillPickerKeyDown({
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
