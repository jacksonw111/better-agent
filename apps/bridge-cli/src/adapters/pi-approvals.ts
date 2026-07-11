// pi's extension_ui_request handling — split out of pi.ts purely to keep it
// under the repo's max-lines-per-file gate. RC-T4: fixes the audited bug
// where an `extension_ui_request` (any interactive extension flow, including
// MCP setup) was entirely unhandled by normalize/pi.ts, silently dropped, and
// hung the whole turn forever with no card and no way out.

import { normalizePiExtensionUiRequest } from "../normalize/pi";
import {
	buildPiExtensionUiCancelResponse,
	buildPiExtensionUiResponse,
} from "../normalize/pi-commands";
import type { NormalizedEvent } from "../normalize/types";
import type { ApprovalRegistry } from "./approvals";
import { presentApproval } from "./approvals";
import { presentQuestion, type QuestionRegistry } from "./questions";

/** Status pushed for an `extension_ui_request` this adapter can't turn into a
 * card at all (`input`/`editor` — free-form text has no deny analog, or a
 * malformed `select` with no usable options) — auto-cancelled immediately, on
 * pi's stdin, so the extension's turn is never left hanging, but still
 * surfaced here so it's never silently invisible either. */
const EXTENSION_UI_AUTO_CANCELLED_STATUS = "extension_ui_auto_cancelled";

/** The plumbing `wirePiExtensionUiRequest` closes over — bundled into one
 * object so it stays under the repo's max-params gate. */
export interface WirePiExtensionUiDeps {
	approvals: ApprovalRegistry;
	events: { push(event: NormalizedEvent): void };
	io: { writeLine(line: string): void };
	questions: QuestionRegistry;
}

/** R3-T1 Part B: a `select` request's card is a `QuestionEvent` — routes
 * through the parallel R3-T3 fail-closed contract (`presentQuestion`)
 * instead of `presentApproval`. `answers[0][0]` is the single question's
 * single chosen option (a `select` dialog has exactly one question, exactly
 * one pick) — `buildPiExtensionUiResponse`'s `select` branch just needs that
 * one string back as `value`. */
function answerPiSelect(
	deps: WirePiExtensionUiDeps,
	requestId: string,
	event: Extract<NormalizedEvent, { kind: "question" }>
): void {
	presentQuestion({
		event,
		events: deps.events,
		onAnswer(answers) {
			const chosen = answers[0]?.[0] ?? "";
			deps.io.writeLine(
				buildPiExtensionUiResponse("select", requestId, chosen)
			);
		},
		onTimeout() {
			deps.io.writeLine(buildPiExtensionUiCancelResponse(requestId));
		},
		questions: deps.questions,
	});
}

/**
 * Called for every parsed stdout line from `drainPiStdout`. A no-op unless
 * `raw.type === "extension_ui_request"`. `confirm` routes through the shared
 * RC-T4 fail-closed contract (`presentApproval`) exactly like codex/opencode's
 * approvals; `select` routes through the parallel R3-T3 question contract
 * (`answerPiSelect`); anything else (`input`/`editor`, or a malformed request
 * `normalizePiExtensionUiRequest` can't turn into a card) is auto-cancelled on
 * the spot — see that function's doc comment for why those two methods have
 * no representable card.
 */
export function wirePiExtensionUiRequest(
	raw: Record<string, unknown>,
	deps: WirePiExtensionUiDeps
): void {
	if (raw.type !== "extension_ui_request" || typeof raw.id !== "string") {
		return;
	}
	const [event] = normalizePiExtensionUiRequest(raw);
	const method = typeof raw.method === "string" ? raw.method : "unknown";
	const requestId = raw.id;
	if (!event) {
		deps.events.push({
			kind: "status",
			status: EXTENSION_UI_AUTO_CANCELLED_STATUS,
			detail: { method, requestId },
		});
		deps.io.writeLine(buildPiExtensionUiCancelResponse(requestId));
		return;
	}
	if (event.kind === "question") {
		answerPiSelect(deps, requestId, event);
		return;
	}
	presentApproval({
		approvals: deps.approvals,
		event,
		events: deps.events,
		onAnswer(optionId) {
			deps.io.writeLine(
				buildPiExtensionUiResponse(method, requestId, optionId)
			);
		},
		onTimeout() {
			deps.io.writeLine(buildPiExtensionUiCancelResponse(requestId));
		},
	});
}
