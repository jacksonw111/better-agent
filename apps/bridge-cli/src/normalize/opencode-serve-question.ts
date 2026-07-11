// R3-T3: `question.asked` normalization — split out of opencode-serve.ts
// purely to keep both files under the repo's 300-line file cap (see
// opencode-serve-agent.ts's header comment for the same precedent).

import {
	asString,
	isRecord,
	NO_EVENTS,
	type NormalizedEvent,
	type QuestionItem,
} from "./types";

/** ASSUMPTION (unverified): a `question.asked` question item's option list
 * arrives as `properties.questions[].options` (plain strings) OR `.labels`
 * (records carrying a `label`/`text`/`id`) — either shape flattens to the
 * option label strings the web renders as buttons. */
function questionOptionLabels(raw: unknown): string[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	const labels: string[] = [];
	for (const item of raw) {
		if (typeof item === "string") {
			labels.push(item);
			continue;
		}
		if (!isRecord(item)) {
			continue;
		}
		const label =
			asString(item.label) ?? asString(item.text) ?? asString(item.id);
		if (label !== undefined) {
			labels.push(label);
		}
	}
	return labels;
}

/** ASSUMPTION (unverified): one question item is `{ question|text: string,
 * options|labels?: [...] }`. `undefined` (not an empty question) for
 * anything missing the text field, so the caller can tell "one bad item
 * among several good ones" apart from "nothing usable at all". */
function parseServeQuestionItem(raw: unknown): QuestionItem | undefined {
	// A single local + single `return` sidesteps the Biome/ESLint fight noted
	// on `fetchJson` (opencode-serve-http.ts): Biome strips an explicit
	// `return undefined;` back to a bare `return;`, which then trips ESLint's
	// `consistent-return` since another path here returns a value.
	let item: QuestionItem | undefined;
	if (isRecord(raw)) {
		const text = asString(raw.question) ?? asString(raw.text);
		if (text !== undefined) {
			item = { text, options: questionOptionLabels(raw.options ?? raw.labels) };
		}
	}
	return item;
}

/** A `question.asked` payload whose `questions` array is missing, empty, or
 * entirely unparseable degrades to ONE generic reject-able yes/no question
 * (titled off `properties.title`, or a fixed fallback) rather than dropping
 * the request — the fail-closed posture `adapters/questions.ts`'s
 * `presentQuestion` establishes only works if a card always reaches the UI. */
const FALLBACK_QUESTION_OPTIONS = ["Yes", "No"];
const FALLBACK_QUESTION_TITLE = "Question";

export function normalizeServeQuestion(
	properties: Record<string, unknown>
): NormalizedEvent[] {
	const requestId = asString(properties.id) ?? asString(properties.requestID);
	if (requestId === undefined) {
		return NO_EVENTS;
	}
	const title = asString(properties.title) ?? FALLBACK_QUESTION_TITLE;
	const rawQuestions = Array.isArray(properties.questions)
		? properties.questions
		: [];
	const parsed = rawQuestions
		.map(parseServeQuestionItem)
		.filter((item): item is QuestionItem => item !== undefined);
	const questions =
		parsed.length > 0
			? parsed
			: [{ text: title, options: FALLBACK_QUESTION_OPTIONS }];
	return [{ kind: "question", requestId, title, questions }];
}
