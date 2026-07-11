import {
	createCodexNormalizer,
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
	type CodexControlState,
	codexTurnStartParams,
	createCodexControlState,
	makeCodexSetModel,
	makeCodexSetPermissionMode,
} from "./codex-controls";
import { logRawCodexNotification } from "./codex-debug";
import { fetchCodexModelList } from "./codex-models";
import {
	type CodexStatusCache,
	codexUsageUpdateEvent,
	createCodexStatusCache,
	makeCodexGetStatus,
	updateCodexStatusCache,
} from "./codex-status";
import { connectJsonRpc, type JsonRpcIo } from "./jsonrpc-io";
import { CODEX_SESSION_CAPABILITIES } from "./session-capabilities";
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

/** Builds `thread/start`'s params: `cwd` plus, when persisted, `model` —
 * verified against `codex-rs/protocol/src/protocol.rs` (`pub model: String`
 * on the thread/turn start request), not guessed; see
 * docs/research/agent-config-codex.md. `permissionMode` isn't threaded here
 * either: codex's nearest concept, `approval_policy`
 * (untrusted/on-request/never), is applied per-TURN instead (R2-T2's
 * `codexTurnStartParams`, sourced from the session's `CodexControlState`),
 * not at thread creation. */
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
	// R2-T2: the mutable per-session model/approval-policy state `setModel`/
	// `setPermissionMode` write into and `send`'s `turn/start` reads back out
	// of (see codex-controls.ts).
	controlState: CodexControlState;
	epoch: TurnEpochRef;
	events: ReturnType<typeof createAsyncQueue<NormalizedEvent>>;
	rpc: JsonRpcIo;
	statusCache: CodexStatusCache;
}

/** Builds the codex `AgentHandle` — the send/interrupt/stop/approval controls
 * over the app-server thread. Extracted so `start` stays under the line gate. */
function makeCodexHandle(
	{ approvals, controlState, epoch, events, rpc, statusCache }: CodexHandleDeps,
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
					// R2-T2: reads the LATEST approval_policy/model — every
					// setModel/setPermissionMode call before this turn is reflected.
					...codexTurnStartParams(controlState),
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
		setModel: makeCodexSetModel(controlState, statusCache),
		setPermissionMode: makeCodexSetPermissionMode(controlState),
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

/** R2-T2 item 1: the one-time `session_ready` status event, pushed once
 * `thread/start` and the `model/list` fetch (or its static fallback — see
 * codex-models.ts) have both settled — mirrors the shape every other adapter
 * emits (`opencode.ts`'s `enrichOpencodeSessionReady`, `pi.ts`'s
 * `makePiSessionReadyTracker`): `sessionId` off the resolved thread id,
 * `model` from the session's persisted startup config (if any — codex's wire
 * itself never echoes back a "current model"), `models` off the fetch, and
 * the static `CODEX_SESSION_CAPABILITIES` handshake. */
function buildCodexSessionReadyEvent(
	threadId: unknown,
	model: string | undefined,
	models: string[]
): NormalizedEvent {
	return {
		kind: "status",
		status: "session_ready",
		detail: {
			sessionId: asString(threadId),
			model,
			models,
			capabilities: CODEX_SESSION_CAPABILITIES,
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
		// R2-T2: seeded from the persisted startup config (if any) so a turn
		// sent right after start already carries it — see codex-controls.ts.
		const controlState = createCodexControlState(opts?.config?.model);
		statusCache.model = controlState.model;
		// R1-T2: one duration-tracking normalizer per session — codex's wire
		// never reports how long a commandExecution/mcpToolCall ran, only a
		// started/completed pair keyed by item id (see normalize/tool-timing.ts).
		const normalize = createCodexNormalizer();
		rpc.onNotification((method, params) => {
			logRawCodexNotification(method, params);
			updateCodexStatusCache(statusCache, method, params);
			// R2-T2 item 4: streams the same usage_update the web already renders
			// for opencode, alongside the existing status-cache update above.
			const usageEvent = codexUsageUpdateEvent(method, params);
			if (usageEvent) {
				events.push(usageEvent);
			}
			for (const event of normalize({ method, params })) {
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
		const threadId = threadIdFrom(started);
		// R2-T2 item 1: guarded by CODEX_MODEL_LIST_TIMEOUT_MS — never hangs
		// `start()`, and always resolves to at least the static fallback list.
		const models = await fetchCodexModelList(rpc);
		events.push(
			buildCodexSessionReadyEvent(threadId, controlState.model, models)
		);
		return makeCodexHandle(
			{ approvals, controlState, epoch, events, rpc, statusCache },
			threadId
		);
	},
};
