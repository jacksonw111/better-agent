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
// `item/fileChange/requestApproval`. We reply with a simplified two-option
// decision, `{ decision: "accept" | "decline" }`, collapsing the documented
// `acceptForSession`/`cancel`/`acceptWithExecpolicyAmendment` variants (no UI
// for those yet). Reverify against the installed codex version — both the
// method names and the reply envelope — before relying on this.

import { type ApprovalEvent, asString, isArrayOf, isRecord } from "./types";

const CODEX_APPROVAL_METHODS = new Set([
	"item/commandExecution/requestApproval",
	"item/fileChange/requestApproval",
]);

/** The only two decisions `answerApproval` can currently produce for codex;
 * see the ASSUMPTION above about the decisions this collapses away. */
const CODEX_APPROVAL_OPTIONS = [
	{ id: "accept", label: "Allow" },
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

/**
 * Maps a codex app-server server-initiated approval *request* — an
 * `onRequest`-surfaced `(id, method, params)`, not an `onNotification` one —
 * to an `ApprovalEvent`, or `[]` if `method` isn't a known approval method.
 */
export function normalizeCodexApprovalRequest(
	requestId: string,
	method: string,
	params: unknown
): ApprovalEvent[] {
	if (!CODEX_APPROVAL_METHODS.has(method)) {
		return [];
	}
	return [
		{
			detail: isRecord(params) ? codexApprovalDetail(params) : undefined,
			kind: "approval",
			options: CODEX_APPROVAL_OPTIONS,
			requestId,
			title: codexApprovalTitle(method),
		},
	];
}
