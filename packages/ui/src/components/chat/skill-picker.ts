// Pure logic for the web chat composer's "/" skill picker — mirrors
// apps/web/src/components/bridge/slash-picker.ts (the bridge terminal's
// command/skill picker), narrowed to skills only and to a slash typed at the
// very START of the message (a web chat message either opens with a skill
// invocation or it doesn't — unlike the terminal, there's no "fix this /pdf"
// mid-message case to support). Kept out of the rendering components so
// parsing/filtering/selection stay unit-testable without rendering anything.

export interface SkillPickerItem {
	description: string;
	name: string;
}

const LEADING_SLASH_TOKEN = /^\/(\S*)$/;

/**
 * Parses the composer's text for a slash token being typed at the START of
 * an otherwise-empty message — a leading `/<word>` with no space yet.
 * Returns the query typed after the slash, or `null` once a space follows
 * (a completed `/name arg`) or the slash isn't the very first character.
 */
export function parseSkillQuery(text: string): string | null {
	const match = LEADING_SLASH_TOKEN.exec(text);
	return match ? (match[1] ?? "") : null;
}

/**
 * Filters `skills` to those whose name matches `query` as a case-insensitive
 * prefix — mirrors buildSlashPickerItems's per-list filtering in the bridge
 * terminal's picker.
 */
export function filterSkillPickerItems(
	skills: SkillPickerItem[],
	query: string
): SkillPickerItem[] {
	const lowerQuery = query.toLowerCase();
	return skills.filter((skill) =>
		skill.name.toLowerCase().startsWith(lowerQuery)
	);
}

/** The text the composer should be set to once `item` is selected — always a
 * bare insertion (never auto-sent) of `/<name> `, so the user can append
 * arguments before pressing Enter. */
export function applySkillPickerSelection(item: SkillPickerItem): string {
	return `/${item.name} `;
}

/** Wraps an index into `[0, itemCount)`, wrapping around at either end —
 * used by arrow-key navigation over the picker list. Returns 0 for an empty
 * list (there is nothing to select, but callers shouldn't have to
 * special-case a NaN/negative index). */
export function clampSkillPickerIndex(
	index: number,
	itemCount: number
): number {
	if (itemCount <= 0) {
		return 0;
	}
	if (index < 0) {
		return itemCount - 1;
	}
	if (index >= itemCount) {
		return 0;
	}
	return index;
}
