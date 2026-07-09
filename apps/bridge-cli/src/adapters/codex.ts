import {
	normalizeCodex,
	normalizeCodexApprovalRequest,
} from "../normalize/codex";
import { type NormalizedEvent, userMessageEvent } from "../normalize/types";
import { createApprovalRegistry, retractPendingApprovals } from "./approvals";
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

function threadIdFrom(result: unknown): unknown {
	if (result === null || typeof result !== "object" || !("thread" in result)) {
		return null;
	}
	const thread = (result as { thread: unknown }).thread;
	if (thread === null || typeof thread !== "object" || !("id" in thread)) {
		return null;
	}
	return (thread as { id: unknown }).id;
}

/** Wires codex's approval *requests* (`execCommandApproval`/`applyPatchApproval`
 * style, id-bearing) to the shared approval registry: registers a reply
 * function that answers the RPC request, and emits the normalized event. */
function wireCodexApprovals(
	rpc: JsonRpcIo,
	events: { push(event: NormalizedEvent): void },
	approvals: ReturnType<typeof createApprovalRegistry>
): void {
	rpc.onRequest((id, method, params) => {
		const requestId = String(id);
		const approvalEvents = normalizeCodexApprovalRequest(
			requestId,
			method,
			params
		);
		const [approvalEvent] = approvalEvents;
		if (!approvalEvent) {
			return;
		}
		approvals.register(requestId, approvalEvent.options, (optionId) => {
			rpc.respond(id, { decision: optionId });
		});
		for (const event of approvalEvents) {
			events.push(event);
		}
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
				.request("turn/start", { threadId, input: [{ type: "text", text }] })
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
