import {
	clampSkillPickerIndex,
	filterSkillPickerItems,
	type SkillPickerItem,
} from "@better-agent/ui/components/chat/skill-picker";
import type {
	ChangeEvent,
	KeyboardEvent,
	RefObject,
	SyntheticEvent,
} from "react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import {
	insertSkillReference,
	parseSlashTokenAtCursor,
} from "./description-slash-picker";

export interface UseDescriptionSlashPickerArgs {
	onChange: (value: string) => void;
	/** The Step 1 Skill Palette — the picker's ONLY candidate source. */
	skills: SkillPickerItem[];
	value: string;
}

export interface UseDescriptionSlashPickerResult {
	activeIndex: number;
	handleChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
	handleKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
	handleSelectionChange: (event: SyntheticEvent<HTMLTextAreaElement>) => void;
	itemDomId: (index: number) => string;
	items: SkillPickerItem[];
	listId: string;
	open: boolean;
	select: (item: SkillPickerItem) => void;
	setActiveIndex: (index: number) => void;
	textareaRef: RefObject<HTMLTextAreaElement | null>;
}

/** Filters the palette against the token at the cursor, resetting the active
 * row whenever the query changes (render-time state reset, same pattern as
 * the chat composer's useSkillPickerItems). */
function usePickerItems(
	value: string,
	cursor: number,
	dismissed: boolean,
	skills: SkillPickerItem[]
) {
	const token = parseSlashTokenAtCursor(value, cursor);
	const items =
		token === null || dismissed
			? []
			: filterSkillPickerItems(skills, token.query);
	const [activeIndex, setActiveIndex] = useState(0);
	const query = token === null ? null : token.query;
	const [seenQuery, setSeenQuery] = useState(query);
	if (query !== seenQuery) {
		setSeenQuery(query);
		setActiveIndex(0);
	}
	return { activeIndex, items, setActiveIndex, token };
}

/** Restores the DOM cursor after a controlled-value insertion — the value
 * update must land first, so the selection move runs in a layout effect. */
function useCursorRestore(textareaRef: RefObject<HTMLTextAreaElement | null>) {
	const [pendingCursor, setPendingCursor] = useState<number | null>(null);
	useLayoutEffect(() => {
		if (pendingCursor === null) {
			return;
		}
		textareaRef.current?.setSelectionRange(pendingCursor, pendingCursor);
		setPendingCursor(null);
	}, [pendingCursor, textareaRef]);
	return setPendingCursor;
}

interface PickerKeyArgs {
	activeIndex: number;
	event: KeyboardEvent<HTMLTextAreaElement>;
	items: SkillPickerItem[];
	onDismiss: () => void;
	select: (item: SkillPickerItem) => void;
	setActiveIndex: (index: number) => void;
}

/** Keyboard nav while the picker is open: arrows move the highlight, Enter
 * inserts the highlighted reference (never submits anything), Escape closes
 * the picker for now without touching the Description text. */
function handlePickerKey({
	activeIndex,
	event,
	items,
	onDismiss,
	select,
	setActiveIndex,
}: PickerKeyArgs): void {
	if (event.key === "ArrowDown") {
		event.preventDefault();
		setActiveIndex(clampSkillPickerIndex(activeIndex + 1, items.length));
		return;
	}
	if (event.key === "ArrowUp") {
		event.preventDefault();
		setActiveIndex(clampSkillPickerIndex(activeIndex - 1, items.length));
		return;
	}
	if (event.key === "Enter") {
		event.preventDefault();
		const item = items[clampSkillPickerIndex(activeIndex, items.length)];
		if (item) {
			select(item);
		}
		return;
	}
	if (event.key === "Escape") {
		event.preventDefault();
		onDismiss();
	}
}

/**
 * Drives the wizard Description's "/" autocomplete: an in-progress slash
 * token at the CURSOR (start of text or after whitespace) opens a dropdown of
 * the palette-checked skills, filtered as the user types. Selecting inserts
 * `/skill-name ` plain text at the cursor — repeatable anywhere in the
 * Description (spec §8.3). Filter semantics are shared with the chat
 * composer's picker (filterSkillPickerItems); parsing/insertion are the
 * cursor-aware versions in description-slash-picker.ts.
 */
interface HandlerDeps {
	activeIndex: number;
	cursor: number;
	items: SkillPickerItem[];
	onChange: (value: string) => void;
	open: boolean;
	setActiveIndex: (index: number) => void;
	setCursor: (cursor: number) => void;
	setDismissed: (dismissed: boolean) => void;
	setPendingCursor: (cursor: number | null) => void;
	token: ReturnType<typeof parseSlashTokenAtCursor>;
	value: string;
}

/** The hook's event handlers as a plain factory — split out purely to keep
 * `useDescriptionSlashPicker` under the repo's max-lines-per-function gate. */
function buildHandlers(deps: HandlerDeps) {
	const select = (item: SkillPickerItem) => {
		if (deps.token === null) {
			return;
		}
		const insertion = insertSkillReference(
			deps.value,
			deps.token,
			deps.cursor,
			item.name
		);
		deps.onChange(insertion.text);
		deps.setCursor(insertion.cursor);
		deps.setPendingCursor(insertion.cursor);
	};
	const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
		deps.onChange(event.target.value);
		deps.setCursor(event.target.selectionStart ?? event.target.value.length);
		deps.setDismissed(false);
	};
	const handleSelectionChange = (
		event: SyntheticEvent<HTMLTextAreaElement>
	) => {
		deps.setCursor(event.currentTarget.selectionStart ?? 0);
	};
	const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (!deps.open) {
			return;
		}
		handlePickerKey({
			activeIndex: deps.activeIndex,
			event,
			items: deps.items,
			onDismiss: () => deps.setDismissed(true),
			select,
			setActiveIndex: deps.setActiveIndex,
		});
	};
	return { handleChange, handleKeyDown, handleSelectionChange, select };
}

export function useDescriptionSlashPicker({
	onChange,
	skills,
	value,
}: UseDescriptionSlashPickerArgs): UseDescriptionSlashPickerResult {
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const listId = useId();
	const [cursor, setCursor] = useState(0);
	const [dismissed, setDismissed] = useState(false);
	const { activeIndex, items, setActiveIndex, token } = usePickerItems(
		value,
		cursor,
		dismissed,
		skills
	);
	const setPendingCursor = useCursorRestore(textareaRef);
	const open = items.length > 0;
	const handlers = buildHandlers({
		activeIndex,
		cursor,
		items,
		onChange,
		open,
		setActiveIndex,
		setCursor,
		setDismissed,
		setPendingCursor,
		token,
		value,
	});

	return {
		activeIndex,
		...handlers,
		itemDomId: (index: number) => `${listId}-item-${index}`,
		items,
		listId,
		open,
		setActiveIndex,
		textareaRef,
	};
}
