import {
	normalizeCodex,
	normalizeCodexApprovalRequest,
} from "../normalize/codex";
import {
	asString,
	isRecord,
	type NormalizedEvent,
	userMessageEvent,
} from "../normalize/types";
import {
	createApprovalRegistry,
	presentApproval,
	retractPendingApprovals,
} from "./approvals";
import { createAsyncQueue } from "./async-queue";
import {
	type CodexStatusCache,
	createCodexStatusCache,
	makeCodexGetStatus,
	updateCodexStatusCache,
} from "./codex-status";
import { connectJsonRpc, type JsonRpcIo } from "./jsonrpc-io";
import {
	bumpTurnEpoch,
	createTurnEpoch,
	type TurnEpochRef,
	turnStampingQueue,
} from "./turn-epoch";
import {
	type Adapter,
	AGENT_EXITED_STATUS,
	type AgentHandle,
	type StartOptions,
} from "./types";

/** codex's app-server response key for `thread/start`'s thread id has
 * drifted across versions — some builds nest it at `thread.id` or
 * `thread.sessionId`, others flatten it to a top-level `sessionId` or
 * `threadId`. Tries each in turn (first non-empty string wins) so a codex
 * version bump doesn't silently produce `threadId: undefined` on every
 * subsequent `turn/start`/`turn/interrupt` call.
 *
 * ASSUMPTION (unverified — no `codex` binary in this sandbox): the exact set
 * of alternate keys. Mirrors hermes's `codex_app_server_session.py`
 * (`thread.id` / `thread.sessionId` / `sessionId` / `threadId`), which
 * verified this cross-version drift against a real codex 0.130.0 binary.
 */
function threadIdFrom(result: unknown): unknown {
	if (!isRecord(result)) {
		return null;
	}
	const thread = isRecord(result.thread) ? result.thread : undefined;
	return (
		asString(thread?.id) ??
		asString(thread?.sessionId) ??
		asString(result.sessionId) ??
		asString(result.threadId) ??
		null
	);
}

/** codex's own wire value for "the user (or the shared RC-T4 timeout) said
 * no" — the same `decision` string `normalizeCodexApprovalRequest`'s
 * `decline` option already sends when a human picks it, reused here so an
 * unanswered card times out into the exact same codex-side effect a manual
 * deny would. */
const CODEX_DECLINE_DECISION = "decline";

/** Wires codex's approval *requests* (`execCommandApproval`/`applyPatchApproval`
 * style, id-bearing) through the shared RC-T4 fail-closed contract
 * (`presentApproval`): registers a reply function that answers the RPC
 * request, presents the card, and — if nobody answers in time — replies
 * `decline` and pushes a visible timed-out event instead of leaving the
 * command blocked forever. */
function wireCodexApprovals(
	rpc: JsonRpcIo,
	events: { push(event: NormalizedEvent): void },
	approvals: ReturnType<typeof createApprovalRegistry>
): void {
	rpc.onRequest((id, method, params) => {
		const requestId = String(id);
		const [approvalEvent] = normalizeCodexApprovalRequest(
			requestId,
			method,
			params
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

/**
 * `codex app-server` — a long-lived JSON-RPC process, one thread per session.
 *
 * ASSUMPTION (unverified, no `codex` binary available in this sandbox):
 * invoked as `codex app-server` with JSON-RPC over its default stdio
 * transport. Some docs/examples show `codex app-server --listen stdio://`
 * as the explicit form; if the installed codex version requires that flag
 * to select stdio, add it to `CODEX_ARGS` below.
 */
const CODEX_ARGS = ["app-server"];

/**
 * RC-T4: gates codex's shell/patch execution — without these, `turn/start`
 * left codex on its config.toml defaults, which (unset) run genuinely
 * unsupervised. Verified against `codex-rs/protocol/src/protocol.rs`'s serde
 * renames (see docs/research/agent-config-codex.md) — the wire VALUES below
 * are confirmed from source, not guessed. `approval_policy: "untrusted"` is
 * the SAFEST of the three simple policies: only "known safe" read-only
 * commands auto-approve, everything else asks (`"on-request"` instead lets
 * the MODEL decide when to ask, which is less safe; `"never"` never asks at
 * all). `sandbox_policy: workspace-write` + `network_access: false` is the
 * SAFEST sandbox that still lets codex do real work: writes are confined to
 * the workspace and outbound network is off (`read-only` would block codex
 * from editing anything at all; `danger-full-access` has no restrictions).
 *
 * ASSUMPTION (unverified — no `codex` binary in this sandbox): the exact JSON
 * key CASING for these two top-level request fields. The doc confirms both
 * fields ride on `turn/start` (and `thread/start`) and quotes the Rust struct
 * field names verbatim as `approval_policy`/`sandbox_policy` (snake_case,
 * with no `#[serde(rename_all)]` noted on the enclosing request struct
 * itself, unlike the kebab-case enum VALUES which ARE explicitly renamed) —
 * so snake_case is used as-is here, but only a real binary run can rule out
 * an additional request-envelope-level camelCase rename layered on top.
 */
const CODEX_APPROVAL_POLICY = "untrusted";
const CODEX_SANDBOX_POLICY = {
	type: "workspace-write",
	network_access: false,
} as const;

/** The two safety-knob fields spread onto `turn/start`'s params — see the
 * `CODEX_APPROVAL_POLICY`/`CODEX_SANDBOX_POLICY` doc above for the exact
 * values chosen and their verification status. */
function codexPolicyParams(): {
	approval_policy: string;
	sandbox_policy: typeof CODEX_SANDBOX_POLICY;
} {
	return {
		approval_policy: CODEX_APPROVAL_POLICY,
		sandbox_policy: CODEX_SANDBOX_POLICY,
	};
}

/** Builds `thread/start`'s params: `cwd` plus, when persisted, `model` —
 * verified against `codex-rs/protocol/src/protocol.rs` (`pub model: String`
 * on the thread/turn start request), not guessed; see
 * docs/research/agent-config-codex.md. `permissionMode` isn't threaded here:
 * codex's nearest concept is `approval_policy`
 * (untrusted/on-request/never), a different value space than the
 * generic `permissionMode` string, and the web's capability matrix
 * (`CODEX_CAPABILITIES.permissionModes`) is still empty — no UI ever
 * populates it yet, so there's nothing to wire up without guessing a
 * mapping. */
function threadStartParams(
	dir: string,
	config: { model?: string } | undefined
): { cwd: string; model?: string } {
	return config?.model ? { cwd: dir, model: config.model } : { cwd: dir };
}

/** The shared plumbing every `AgentHandle` method closes over — bundled into
 * one object so `makeCodexHandle` stays under the repo's max-params gate. */
interface CodexHandleDeps {
	approvals: ReturnType<typeof createApprovalRegistry>;
	epoch: TurnEpochRef;
	events: ReturnType<typeof createAsyncQueue<NormalizedEvent>>;
	rpc: JsonRpcIo;
	statusCache: CodexStatusCache;
}

/** Builds the codex `AgentHandle` — the send/interrupt/stop/approval controls
 * over the app-server thread. Extracted so `start` stays under the line gate. */
function makeCodexHandle(
	{ approvals, epoch, events, rpc, statusCache }: CodexHandleDeps,
	threadId: unknown
): AgentHandle {
	return {
		answerApproval(requestId: string, optionId: string): void {
			approvals.answer(requestId, optionId);
		},
		events,
		getStatus: makeCodexGetStatus(statusCache, events),
		send(text: string): void {
			// A new turn begins — bump the epoch BEFORE pushing the user's own
			// turn-start event (see the RC-T3 note on `codexAdapter.start`).
			bumpTurnEpoch(epoch);
			events.push(userMessageEvent(text));
			rpc
				.request("turn/start", {
					threadId,
					input: [{ type: "text", text }],
					...codexPolicyParams(),
				})
				.catch((error: unknown) => {
					events.push({
						kind: "error",
						message: "codex turn/start failed",
						detail: error,
					});
				});
		},
		// Cancel the active turn WITHOUT tearing down the thread — the detail
		// page's Stop/Interrupt button. Previously codex had no interrupt at all,
		// so that button did nothing; `stop()` only killed the process.
		// ASSUMPTION (unverified, no codex binary): `turn/interrupt` cancels the
		// running turn on the thread.
		//
		// RC-T3: supersede the current turn and retract any pending approval
		// BEFORE requesting the interrupt, so a straggler notification or a late
		// approval answer can never land against a turn context that's already
		// moved on — mirrors claude-code.ts's `interrupt()`.
		interrupt(): void {
			bumpTurnEpoch(epoch);
			retractPendingApprovals(approvals, events);
			rpc.request("turn/interrupt", { threadId }).catch(() => undefined);
		},
		stop(): void {
			bumpTurnEpoch(epoch);
			// Retract before close(): a push after the queue is closed is a
			// silent no-op (see async-queue.ts), so the cancelled ApprovalEvent
			// must land first.
			retractPendingApprovals(approvals, events);
			rpc.stop();
			events.close();
			approvals.clear();
		},
	};
}

export const codexAdapter: Adapter = {
	async start(dir: string, opts?: StartOptions): Promise<AgentHandle> {
		const rpc = await connectJsonRpc("codex", CODEX_ARGS, dir);
		const epoch = createTurnEpoch();
		const events = turnStampingQueue(
			createAsyncQueue<NormalizedEvent>(),
			epoch
		);
		const approvals = createApprovalRegistry(events);
		rpc.onExit(() => {
			events.push({ kind: "status", status: AGENT_EXITED_STATUS });
			events.close();
			approvals.clear();
		});

		const statusCache = createCodexStatusCache();
		rpc.onNotification((method, params) => {
			updateCodexStatusCache(statusCache, method, params);
			for (const event of normalizeCodex({ method, params })) {
				events.push(event);
			}
		});
		wireCodexApprovals(rpc, events, approvals);

		await rpc.request("initialize", {
			clientInfo: { name: "better-agent-bridge", version: "0.0.0" },
		});
		rpc.notify("initialized", {});
		const started = await rpc.request(
			"thread/start",
			threadStartParams(dir, opts?.config)
		);
		return makeCodexHandle(
			{ approvals, epoch, events, rpc, statusCache },
			threadIdFrom(started)
		);
	},
};
