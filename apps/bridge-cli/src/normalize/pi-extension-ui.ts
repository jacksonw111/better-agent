// Split out of pi.ts to keep that file under the repo's 300-line cap —
// pi's `extension_ui_request`/`extension_ui_response` sub-protocol (RC-T4).
//
// `confirm` has a finite, nameable set of choices, so it maps to an
// `ApprovalEvent`. `select` (R3-T1 Part B) instead reuses the web's
// QuestionCard path — a `QuestionEvent` with exactly one question — so a
// select with many options renders as the same picker opencode's
// `question.asked` already drives, rather than a wall of approval buttons.
// `input`/`editor` ask for free-form text (no deny analog) and are
// auto-cancelled immediately by `adapters/pi-approvals.ts` instead of ever
// reaching this function as a card — see `buildPiExtensionUiCancelResponse`'s
// doc comment (normalize/pi-commands.ts) for the full request/response shape
// reference.

import type { ApprovalEvent, ApprovalOption, QuestionEvent } from "./types";
import { asString } from "./types";

// R3-T1 Part B: ids/labels a Chinese-speaking user recognizes as "yes/no",
// matching the option ids `buildPiExtensionUiResponse` (pi-commands.ts) reads
// back out to decide `confirmed: true | false`.
const PI_CONFIRM_OPTIONS: ApprovalOption[] = [
	{ id: "confirm", label: "确认" },
	{ id: "cancel", label: "取消" },
];

function piSelectOptions(raw: Record<string, unknown>): string[] {
	if (!Array.isArray(raw.options)) {
		return [];
	}
	return raw.options.filter(
		(option): option is string => typeof option === "string"
	);
}

function piRequestTitle(raw: Record<string, unknown>): string {
	return asString(raw.title) ?? "pi extension needs an answer";
}

function normalizePiSelectRequest(
	raw: Record<string, unknown>,
	requestId: string
): QuestionEvent[] {
	const options = piSelectOptions(raw);
	if (options.length === 0) {
		return [];
	}
	const title = piRequestTitle(raw);
	return [
		{
			kind: "question",
			questions: [{ options, text: title }],
			requestId,
			title,
		},
	];
}

function normalizePiConfirmRequest(
	raw: Record<string, unknown>,
	requestId: string
): ApprovalEvent[] {
	return [
		{
			detail: asString(raw.message),
			kind: "approval",
			options: PI_CONFIRM_OPTIONS,
			requestId,
			title: piRequestTitle(raw),
		},
	];
}

/**
 * Maps an `extension_ui_request` to the card it becomes: `select` → a
 * `QuestionEvent` (one question, its options), `confirm` → an `ApprovalEvent`
 * (确认/取消). `[]` for `input`/`editor`, a malformed `select` with no usable
 * string options, or any non-matching line.
 */
export function normalizePiExtensionUiRequest(
	raw: Record<string, unknown>
): Array<ApprovalEvent | QuestionEvent> {
	// `[]` isn't reused from a shared `NO_EVENTS` here: it's typed
	// `NormalizedEvent[]`, too broad for this function's return type.
	if (raw.type !== "extension_ui_request" || typeof raw.id !== "string") {
		return [];
	}
	if (raw.method === "select") {
		return normalizePiSelectRequest(raw, raw.id);
	}
	if (raw.method === "confirm") {
		return normalizePiConfirmRequest(raw, raw.id);
	}
	return [];
}
