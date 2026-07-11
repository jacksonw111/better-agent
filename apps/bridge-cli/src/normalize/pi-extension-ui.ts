// Split out of pi.ts to keep that file under the repo's 300-line cap —
// pi's `extension_ui_request`/`extension_ui_response` sub-protocol (RC-T4).
//
// Only `select`/`confirm` have a finite, nameable set of choices, so only
// those two map to an `ApprovalEvent` here; `input`/`editor` ask for
// free-form text (no deny analog) and are auto-cancelled immediately by
// `adapters/pi-approvals.ts` instead of ever reaching this function as a
// card — see `buildPiExtensionUiCancelResponse`'s doc comment
// (normalize/pi-commands.ts) for the full request/response shape reference.

import { type ApprovalEvent, type ApprovalOption, asString } from "./types";

const PI_CONFIRM_OPTIONS: ApprovalOption[] = [
	{ id: "confirmed", label: "Confirm" },
	{ id: "declined", label: "Decline" },
];

function piSelectOptions(raw: Record<string, unknown>): ApprovalOption[] {
	if (!Array.isArray(raw.options)) {
		return [];
	}
	return raw.options
		.filter((option): option is string => typeof option === "string")
		.map((label) => ({ id: label, label }));
}

/**
 * Maps an `extension_ui_request` whose `method` is `select` or `confirm` to
 * an `ApprovalEvent`; `[]` for `input`/`editor`, a malformed `select` with no
 * usable string options, or any non-matching line.
 */
export function normalizePiExtensionUiRequest(
	raw: Record<string, unknown>
): ApprovalEvent[] {
	// `[]` isn't reused from a shared `NO_EVENTS` here: it's typed
	// `NormalizedEvent[]`, too broad for this function's `ApprovalEvent[]`
	// return type.
	if (raw.type !== "extension_ui_request" || typeof raw.id !== "string") {
		return [];
	}
	if (raw.method !== "select" && raw.method !== "confirm") {
		return [];
	}
	const options =
		raw.method === "select" ? piSelectOptions(raw) : PI_CONFIRM_OPTIONS;
	if (options.length === 0) {
		return [];
	}
	return [
		{
			detail: asString(raw.message),
			kind: "approval",
			options,
			requestId: raw.id,
			title: asString(raw.title) ?? "pi extension needs an answer",
		},
	];
}
