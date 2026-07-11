// wireCodexApprovals — split out of codex.ts to keep that file under the
// repo's 300-line cap. Wires codex's approval *requests*
// (`execCommandApproval`/`applyPatchApproval` style, id-bearing) through the
// shared RC-T4 fail-closed contract (`presentApproval`): registers a reply
// function that answers the RPC request, presents the card, and — if nobody
// answers in time — replies `decline` and pushes a visible timed-out event
// instead of leaving the command blocked forever.

import { normalizeCodexApprovalRequest } from "../normalize/codex";
import type { CodexFileChangeCache } from "../normalize/codex-file-change-cache";
import type { NormalizedEvent } from "../normalize/types";
import { type createApprovalRegistry, presentApproval } from "./approvals";
import type { JsonRpcIo } from "./jsonrpc-io";

/** codex's own wire value for "the user (or the shared RC-T4 timeout) said
 * no" — the same `decision` string `normalizeCodexApprovalRequest`'s
 * `decline` option already sends when a human picks it, reused here so an
 * unanswered card times out into the exact same codex-side effect a manual
 * deny would. */
const CODEX_DECLINE_DECISION = "decline";

/** `fileChangeCache` is the same instance `createCodexNormalizer` records
 * fileChange `item/started` items into (R3-T2) — passed through to
 * `normalizeCodexApprovalRequest` so a `item/fileChange/requestApproval`
 * request can attach the change summary the cache built for its item id. */
export function wireCodexApprovals(
	rpc: JsonRpcIo,
	events: { push(event: NormalizedEvent): void },
	approvals: ReturnType<typeof createApprovalRegistry>,
	fileChangeCache: CodexFileChangeCache
): void {
	rpc.onRequest((id, method, params) => {
		const requestId = String(id);
		const [approvalEvent] = normalizeCodexApprovalRequest(
			requestId,
			method,
			params,
			fileChangeCache
		);
		if (!approvalEvent) {
			return;
		}
		presentApproval({
			approvals,
			event: approvalEvent,
			events,
			onAnswer: (optionId) => rpc.respond(id, { decision: optionId }),
			onTimeout: () => rpc.respond(id, { decision: CODEX_DECLINE_DECISION }),
		});
	});
}
