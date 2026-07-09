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

/** Status pushed for an `extension_ui_request` this adapter can't turn into a
 * card at all (`input`/`editor` — free-form text has no deny analog, or a
 * malformed `select` with no usable options) — auto-cancelled immediately, on
 * pi's stdin, so the extension's turn is never left hanging, but still
 * surfaced here so it's never silently invisible either. */
const EXTENSION_UI_AUTO_CANCELLED_STATUS = "extension_ui_auto_cancelled";

/**
 * Called for every parsed stdout line from `drainPiStdout`. A no-op unless
 * `raw.type === "extension_ui_request"`. `select`/`confirm` requests route
 * through the shared RC-T4 fail-closed contract (`presentApproval`) exactly
 * like codex/opencode's approvals; anything else (`input`/`editor`, or a
 * malformed request `normalizePiExtensionUiRequest` can't turn into a card)
 * is auto-cancelled on the spot — see that function's doc comment for why
 * those two methods have no representable card.
 */
export function wirePiExtensionUiRequest(
	raw: Record<string, unknown>,
	io: { writeLine(line: string): void },
	events: { push(event: NormalizedEvent): void },
	approvals: ApprovalRegistry
): void {
	if (raw.type !== "extension_ui_request" || typeof raw.id !== "string") {
		return;
	}
	const [approvalEvent] = normalizePiExtensionUiRequest(raw);
	const method = typeof raw.method === "string" ? raw.method : "unknown";
	const requestId = raw.id;
	if (!approvalEvent) {
		events.push({
			kind: "status",
			status: EXTENSION_UI_AUTO_CANCELLED_STATUS,
			detail: { method, requestId },
		});
		io.writeLine(buildPiExtensionUiCancelResponse(requestId));
		return;
	}
	presentApproval({
		approvals,
		event: approvalEvent,
		events,
		onAnswer(optionId) {
			io.writeLine(buildPiExtensionUiResponse(method, requestId, optionId));
		},
		onTimeout() {
			io.writeLine(buildPiExtensionUiCancelResponse(requestId));
		},
	});
}
