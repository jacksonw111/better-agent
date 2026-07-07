import {
	normalizeCodex,
	normalizeCodexApprovalRequest,
} from "../normalize/codex";
import { type NormalizedEvent, userMessageEvent } from "../normalize/types";
import { createApprovalRegistry } from "./approvals";
import { createAsyncQueue } from "./async-queue";
import { connectJsonRpc, type JsonRpcIo } from "./jsonrpc-io";
import { type Adapter, AGENT_EXITED_STATUS, type AgentHandle } from "./types";

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

/** Builds the codex `AgentHandle` — the send/interrupt/stop/approval controls
 * over the app-server thread. Extracted so `start` stays under the line gate. */
function makeCodexHandle(
	rpc: JsonRpcIo,
	events: ReturnType<typeof createAsyncQueue<NormalizedEvent>>,
	approvals: ReturnType<typeof createApprovalRegistry>,
	threadId: unknown
): AgentHandle {
	return {
		answerApproval(requestId: string, optionId: string): void {
			approvals.answer(requestId, optionId);
		},
		events,
		send(text: string): void {
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
		interrupt(): void {
			rpc.request("turn/interrupt", { threadId }).catch(() => undefined);
		},
		stop(): void {
			rpc.stop();
			events.close();
			approvals.clear();
		},
	};
}

export const codexAdapter: Adapter = {
	async start(dir: string): Promise<AgentHandle> {
		const rpc = await connectJsonRpc("codex", CODEX_ARGS, dir);
		const events = createAsyncQueue<NormalizedEvent>();
		const approvals = createApprovalRegistry(events);
		rpc.onExit(() => {
			events.push({ kind: "status", status: AGENT_EXITED_STATUS });
			events.close();
			approvals.clear();
		});

		rpc.onNotification((method, params) => {
			for (const event of normalizeCodex({ method, params })) {
				events.push(event);
			}
		});
		wireCodexApprovals(rpc, events, approvals);

		await rpc.request("initialize", {
			clientInfo: { name: "better-agent-bridge", version: "0.0.0" },
		});
		rpc.notify("initialized", {});
		const started = await rpc.request("thread/start", { cwd: dir });
		return makeCodexHandle(rpc, events, approvals, threadIdFrom(started));
	},
};
