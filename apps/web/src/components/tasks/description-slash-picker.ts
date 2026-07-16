// Pure logic for the New Task wizard Description's "/" autocomplete. The
// palette-filter semantics mirror the chat composer's skill picker
// (packages/ui/src/components/chat/skill-picker.ts — the wizard reuses its
// filterSkillPickerItems/clampSkillPickerIndex directly), but where the chat
// composer only completes a slash at the very start of the message, the
// wizard inserts Skill References at the CURSOR, anywhere in the Description,
// any number of times (spec §8.3). Kept out of the rendering components so
// parsing/insertion stay unit-testable without rendering anything.

export interface SlashTokenAtCursor {
	/** Text typed after the slash, up to the cursor. */
	query: string;
	/** Index of the "/" that opens the token. */
	start: number;
}

// An in-progress token is `/<word>` ending exactly at the cursor whose "/"
// sits at the start of the text or after whitespace — `a/b` paths and
// already-completed `/name ` references never reopen the picker.
const SLASH_TOKEN_BEFORE_CURSOR = /(?:^|\s)(\/(\S*))$/;

/**
 * Parses the Description for a slash token being typed immediately before
 * `cursor`. Returns the query typed after the slash and where the token
 * starts, or `null` when the cursor is not at the end of one.
 */
export function parseSlashTokenAtCursor(
	text: string,
	cursor: number
): SlashTokenAtCursor | null {
	const beforeCursor = text.slice(0, cursor);
	const match = SLASH_TOKEN_BEFORE_CURSOR.exec(beforeCursor);
	if (!match) {
		return null;
	}
	const token = match[1] ?? "";
	return { query: match[2] ?? "", start: cursor - token.length };
}

export interface SkillReferenceInsertion {
	cursor: number;
	text: string;
}

/**
 * Replaces the in-progress slash token with `/skillName ` plain text and
 * puts the cursor right after the inserted reference. The Description stays
 * an ordinary editable string — a Skill Reference is only ever visible text
 * (spec §6.6), never a hidden instruction.
 */
export function insertSkillReference(
	text: string,
	token: SlashTokenAtCursor,
	cursor: number,
	skillName: string
): SkillReferenceInsertion {
	const inserted = `/${skillName} `;
	return {
		cursor: token.start + inserted.length,
		text: text.slice(0, token.start) + inserted + text.slice(cursor),
	};
}
