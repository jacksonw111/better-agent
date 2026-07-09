import type { SkillRow } from "../ports";
import type { MessageWithParts } from "./types";

// Skills T3: `/skill-name` activation is derived from the conversation rather
// than a session-state column (see docs/web-agent-skills-plan.md — "no new
// session-state column"). This module is pure (no store/DB access) so it can
// be shared by the agent runtime (system-prompt injection, turn-messages.ts)
// AND the api layer (tool-folding, agent-tool-defs.ts) without either side
// depending on the other's I/O.

const SLASH_DIRECTIVE = /^\/(\S+)/;
const CLEAR_TOKEN = "clear";

/** Every user message's text, oldest → newest (one string per message, its
 * text parts joined) — the full scan window for activation detection. */
export function collectUserTexts(history: MessageWithParts[]): string[] {
	const texts: string[] = [];
	for (const entry of history) {
		if (entry.message.role !== "user") {
			continue;
		}
		const lines: string[] = [];
		for (const part of entry.parts) {
			if (part.type === "text") {
				lines.push(part.content.text);
			}
		}
		texts.push(lines.join("\n"));
	}
	return texts;
}

/**
 * Scans user texts latest → oldest for the most recent `/<name>` directive
 * (at the START of the message) that either names an assigned skill or is
 * `/clear`. Directives matching neither (unrecognized slash commands) are
 * ignored — they neither activate nor deactivate; the scan continues further
 * back in the history. Returns the matched skill's name, or null when
 * deactivated (`/clear`) or never activated.
 */
export function findActiveSkillName(
	texts: string[],
	skills: SkillRow[]
): string | null {
	const names = new Set(skills.map((skill) => skill.name));
	for (let i = texts.length - 1; i >= 0; i--) {
		const match = texts[i]?.trim().match(SLASH_DIRECTIVE);
		const token = match?.[1];
		if (!token) {
			continue;
		}
		if (token === CLEAR_TOKEN) {
			return null;
		}
		if (names.has(token)) {
			return token;
		}
	}
	return null;
}

/** Same scan as {@link findActiveSkillName}, resolved to the full skill row. */
export function findActiveSkill(
	texts: string[],
	skills: SkillRow[]
): SkillRow | null {
	const name = findActiveSkillName(texts, skills);
	if (!name) {
		return null;
	}
	return skills.find((skill) => skill.name === name) ?? null;
}
