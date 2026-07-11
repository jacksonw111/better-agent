// The text command + its optional busy-turn `when` (R3-T1) — split out of
// commands.ts purely to keep that file under the repo's 300-line file cap
// (same precedent as commands-question.ts).

import type { TextWhen } from "./adapters/types";

/** A plain-text command to feed to the agent via `send` (or `sendWith` when
 * `when` requests non-default busy handling). Absent `when` — a bare string,
 * `{ text }`, or an unrecognized value — means "queue", the always-safe
 * default. */
export interface TextCommand {
	text: string;
	type: "text";
	when?: TextWhen;
}

const TEXT_WHEN_VALUES: readonly TextWhen[] = ["queue", "steer", "interrupt"];

function parseTextWhen(value: unknown): TextWhen | undefined {
	return typeof value === "string" &&
		(TEXT_WHEN_VALUES as readonly string[]).includes(value)
		? (value as TextWhen)
		: undefined;
}

/** Builds a `TextCommand` from a bare `text` plus whatever raw `when` value
 * (if any) rode along with it — `parseCommandText`'s (commands.ts) shared
 * final step for both the bare-string and `{ text, when? }` shapes. An
 * unrecognized `when` degrades to the same "queue" default as an absent one,
 * never a rejected/`null` parse. */
export function parseTextCommand(
	text: string,
	whenValue: unknown
): TextCommand {
	const when = parseTextWhen(whenValue);
	return when ? { text, type: "text", when } : { text, type: "text" };
}
