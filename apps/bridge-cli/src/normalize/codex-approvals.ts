// Split out of codex.ts to keep that file under the repo's 300-line cap —
// codex app-server's server-initiated approval *requests* (as opposed to the
// `item/*`/`turn/*` notifications the rest of codex.ts maps).
//
// ASSUMPTION (unverified — no `codex` binary is available in this sandbox;
// method names per https://developers.openai.com/codex/app-server, which
// documents the approval workflow and the client's decision vocabulary but
// not the literal JSON-RPC envelope for the *request* side): the app-server
// asks for approval via a server-initiated *request* — an id-bearing
// message, handled by `jsonrpc-io.ts`'s `onRequest`, not a notification —
// named `item/commandExecution/requestApproval` or
// `item/fileChange/requestApproval`. We reply with `{ decision: "accept" |
// "acceptForSession" | "decline" }` — the three decisions hermes-verified
// against a real codex binary (`codex_app_server_session.py:1031`); the
// documented `cancel`/`acceptWithExecpolicyAmendment` variants still have no
// UI. Reverify the method names and the reply envelope — and the
// `requestApproval` params shape ASSUMPTION-marked below — before relying on
// this.

import type { CodexFileChangeCache } from "./codex-file-change-cache";
import { type ApprovalEvent, asString, isArrayOf, isRecord } from "./types";

const CODEX_APPROVAL_METHODS = new Set([
	"item/commandExecution/requestApproval",
	"item/fileChange/requestApproval",
]);

/** The three decisions `answerApproval` can produce for codex — literal wire
 * strings that must pass through `adapters/codex.ts`'s `rpc.respond(id,
 * { decision: optionId })` unchanged; see the file header for the
 * hermes-verified source. */
const CODEX_APPROVAL_OPTIONS = [
	{ id: "accept", label: "Allow" },
	{ id: "acceptForSession", label: "Allow for session" },
	{ id: "decline", label: "Deny" },
];

function codexApprovalTitle(method: string): string {
	return method === "item/fileChange/requestApproval"
		? "Apply file change?"
		: "Run command?";
}

function codexApprovalDetail(
	params: Record<string, unknown>
): string | undefined {
	const command = isArrayOf(
		params.command,
		(part): part is string => typeof part === "string"
	)
		? params.command.join(" ")
		: asString(params.command);
	return command ?? asString(params.reason);
}

/** ASSUMPTION (unverified, no `codex` binary): a fileChange approval
 * request's params carry the pending item's id at `itemId` — the same field
 * name the existing commandExecution request tests already assume
 * (`codex-approvals.test.ts`) — linking this request back to the
 * `item/started` fileChange item `codex-file-change-cache.ts` cached a
 * summary for. `undefined` (no `summary` attached) if the field is missing,
 * mistyped, or the cache never saw a matching `item/started`. */
function codexFileChangeSummary(
	params: Record<string, unknown>,
	fileChangeCache: CodexFileChangeCache | undefined
): string | undefined {
	const itemId = asString(params.itemId);
	return itemId === undefined ? undefined : fileChangeCache?.summaryFor(itemId);
}

/**
 * Maps a codex app-server server-initiated approval *request* — an
 * `onRequest`-surfaced `(id, method, params)`, not an `onNotification` one —
 * to an `ApprovalEvent`, or `[]` if `method` isn't a known approval method.
 * `fileChangeCache`, when given, supplies `summary` for a fileChange request
 * whose item id it recorded from an earlier `item/started` (see
 * `codex-file-change-cache.ts`); commandExecution requests never get one —
 * there's no comparable pending-item cache for them.
 */
export function normalizeCodexApprovalRequest(
	requestId: string,
	method: string,
	params: unknown,
	fileChangeCache?: CodexFileChangeCache
): ApprovalEvent[] {
	if (!CODEX_APPROVAL_METHODS.has(method)) {
		return [];
	}
	const record = isRecord(params) ? params : undefined;
	const summary =
		record && method === "item/fileChange/requestApproval"
			? codexFileChangeSummary(record, fileChangeCache)
			: undefined;
	return [
		{
			detail: record ? codexApprovalDetail(record) : undefined,
			kind: "approval",
			options: CODEX_APPROVAL_OPTIONS,
			requestId,
			summary,
			title: codexApprovalTitle(method),
		},
	];
}
