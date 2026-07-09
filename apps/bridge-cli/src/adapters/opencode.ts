import {
	FALLBACK_DENY_OPTION_ID,
	normalizeOpencode,
	normalizeOpencodeApprovalRequest,
} from "../normalize/opencode";
import {
	isRecord,
	type NormalizedEvent,
	userMessageEvent,
} from "../normalize/types";
import {
	type ApprovalRegistry,
	createApprovalRegistry,
	presentApproval,
	retractPendingApprovals,
} from "./approvals";
import { type AsyncQueue, createAsyncQueue } from "./async-queue";
import { connectJsonRpc, type JsonRpcIo } from "./jsonrpc-io";
import {
	createOpencodeStatusCache,
	makeOpencodeGetStatus,
	updateOpencodeStatusCache,
} from "./opencode-status";
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

/** Reply outcome sent back for a `session/request_permission` request. See
 * the ASSUMPTION note in normalize/opencode.ts about this shape. */
function acpSelectedOutcome(optionId: string): unknown {
	return { outcome: { optionId, outcome: "selected" } };
}

/** RC-T4: the reply for a request that has no real optionId to select — the
 * shared timeout firing, or the user picking the synthetic
 * `FALLBACK_DENY_OPTION_ID` card (see normalize/opencode.ts). ASSUMPTION
 * (unverified — no `opencode` binary in this sandbox; shape per the ACP
 * spec's `RequestPermissionOutcome` union, which alongside `selected` also
 * documents a no-selection `cancelled` variant): `{ outcome: { outcome:
 * "cancelled" } }`. */
function acpCancelledOutcome(): unknown {
	return { outcome: { outcome: "cancelled" } };
}

/** Merges the two pieces of context ACP's `available_commands_update`
 * notification doesn't itself carry — the directory this adapter was started
 * in and the session id `session/new` returned — into the `session_ready`
 * event `normalizeOpencode` built from it. */
function enrichOpencodeSessionReady(
	event: Extract<NormalizedEvent, { kind: "status" }>,
	dir: string,
	sessionId: string | undefined
): NormalizedEvent {
	const detail = isRecord(event.detail) ? event.detail : {};
	return {
		kind: "status",
		status: "session_ready",
		detail: { ...detail, cwd: dir, sessionId },
	};
}

/**
 * Wires opencode's ACP `session/update` notification stream to `events`,
 * folding its (at most one, per `normalize/opencode.ts`'s ASSUMPTION note on
 * `normalizeAcpAvailableCommands`) `session_ready` event through
 * `enrichOpencodeSessionReady` and a guard so a hypothetical duplicate
 * `available_commands_update` can never re-emit it. `getSessionId` is read
 * lazily (not captured at registration time) since this handler is wired up
 * before `session/new` resolves with the session id it needs.
 */
function makeOpencodeNotificationHandler(
	dir: string,
	events: { push(event: NormalizedEvent): void },
	getSessionId: () => string | undefined
): (method: string, params: unknown) => void {
	let sessionReadyEmitted = false;
	return (method: string, params: unknown): void => {
		for (const event of normalizeOpencode({ method, params })) {
			if (event.kind === "status" && event.status === "session_ready") {
				if (sessionReadyEmitted) {
					continue;
				}
				sessionReadyEmitted = true;
				events.push(enrichOpencodeSessionReady(event, dir, getSessionId()));
				continue;
			}
			events.push(event);
		}
	};
}

/** Wires opencode's ACP `session/request_permission` requests through the
 * shared RC-T4 fail-closed contract (`presentApproval`): registers a reply
 * function that answers the RPC request, presents the card, and — if nobody
 * answers in time — replies with a cancelled outcome and pushes a visible
 * timed-out event instead of leaving the tool call blocked forever. A reply
 * for the synthetic `FALLBACK_DENY_OPTION_ID` (normalize/opencode.ts's fix
 * for the audited empty-options silent-hang bug) also gets the cancelled
 * outcome, never `acpSelectedOutcome` — there's no real optionId behind it. */
function wireOpencodeApprovals(
	rpc: JsonRpcIo,
	events: { push(event: NormalizedEvent): void },
	approvals: ReturnType<typeof createApprovalRegistry>
): void {
	rpc.onRequest((id, method, params) => {
		const requestId = String(id);
		const [approvalEvent] = normalizeOpencodeApprovalRequest(
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
			onAnswer(optionId) {
				rpc.respond(
					id,
					optionId === FALLBACK_DENY_OPTION_ID
						? acpCancelledOutcome()
						: acpSelectedOutcome(optionId)
				);
			},
			onTimeout: () => rpc.respond(id, acpCancelledOutcome()),
		});
	});
}

// ASSUMPTION (unverified, no `opencode` binary in this sandbox; method names
// per the plan's §2 research): the model menu's pick maps to ACP
// `unstable_setSessionModel`, the build/plan mode menu to `session/set_mode`.
// Both are fire-and-forget; a failure is swallowed rather than surfaced,
// matching claude-code's `.catch(() => undefined)`. Extracted to a helper so
// the `start` method stays under the max-lines-per-function gate.
function opencodeModeControls(
	rpc: JsonRpcIo,
	getSessionId: () => string | undefined
): Pick<AgentHandle, "setModel" | "setPermissionMode"> {
	return {
		setModel(model: string): void {
			rpc
				.request("unstable_setSessionModel", {
					sessionId: getSessionId(),
					model,
				})
				.catch(() => undefined);
		},
		setPermissionMode(mode: string): void {
			rpc
				.request("session/set_mode", { sessionId: getSessionId(), mode })
				.catch(() => undefined);
		},
	};
}

/** R2-b: applies the persisted startup config's `model`/`permissionMode` (if
 * any) right after `session/new` resolves, via the exact same ACP calls
 * `opencodeModeControls` wires up for the LIVE picker/menu — so this carries
 * the same unstable_setSessionModel/session/set_mode ASSUMPTION already noted
 * there, not a new one. Fire-and-forget, same as the live controls. */
function applyOpencodeStartupConfig(
	controls: Pick<AgentHandle, "setModel" | "setPermissionMode">,
	config: { model?: string; permissionMode?: string } | undefined
): void {
	if (config?.model) {
		controls.setModel?.(config.model);
	}
	if (config?.permissionMode) {
		controls.setPermissionMode?.(config.permissionMode);
	}
}

/** The `send` control — echoes the user's line and issues `session/prompt`.
 * Extracted so `start` stays under the max-lines-per-function gate. */
function opencodeSend(
	rpc: JsonRpcIo,
	events: { push(event: NormalizedEvent): void },
	getSessionId: () => string | undefined,
	epoch: TurnEpochRef
): (text: string) => void {
	return (text: string) => {
		// A new turn begins — bump the epoch BEFORE pushing the user's own
		// turn-start event (see the RC-T3 note on `opencodeAdapter.start`).
		bumpTurnEpoch(epoch);
		events.push(userMessageEvent(text));
		rpc
			.request("session/prompt", {
				sessionId: getSessionId(),
				prompt: [{ type: "text", text }],
			})
			.catch((error: unknown) => {
				events.push({
					kind: "error",
					message: "opencode session/prompt failed",
					detail: error,
				});
			});
	};
}

/** Wires the turn-epoch-stamped event queue, approval registry, and the
 * rpc-exit cleanup shared by every ACP session — extracted purely so `start`
 * stays under the line gate. */
function createOpencodePipeline(rpc: JsonRpcIo): {
	approvals: ApprovalRegistry;
	epoch: TurnEpochRef;
	events: AsyncQueue<NormalizedEvent>;
} {
	const epoch = createTurnEpoch();
	const events = turnStampingQueue(createAsyncQueue<NormalizedEvent>(), epoch);
	const approvals = createApprovalRegistry(events);
	rpc.onExit(() => {
		events.push({ kind: "status", status: AGENT_EXITED_STATUS });
		events.close();
		approvals.clear();
	});
	return { approvals, epoch, events };
}

/** `opencode acp` — the Agent Client Protocol server built into opencode. */
export const opencodeAdapter: Adapter = {
	async start(dir: string, opts?: StartOptions): Promise<AgentHandle> {
		const rpc = await connectJsonRpc("opencode", ["acp"], dir);
		const { approvals, epoch, events } = createOpencodePipeline(rpc);

		let sessionId: string | undefined;
		rpc.onNotification(
			makeOpencodeNotificationHandler(dir, events, () => sessionId)
		);
		const statusCache = createOpencodeStatusCache();
		rpc.onNotification((method, params) => {
			updateOpencodeStatusCache(statusCache, method, params);
		});
		wireOpencodeApprovals(rpc, events, approvals);

		await rpc.request("initialize", { protocolVersion: 1 });
		const session = await rpc.request("session/new", {
			cwd: dir,
			mcpServers: [],
		});
		sessionId =
			isRecord(session) && typeof session.sessionId === "string"
				? session.sessionId
				: undefined;

		const modeControls = opencodeModeControls(rpc, () => sessionId);
		applyOpencodeStartupConfig(modeControls, opts?.config);

		return {
			answerApproval(requestId: string, optionId: string): void {
				approvals.answer(requestId, optionId);
			},
			events,
			getStatus: makeOpencodeGetStatus(statusCache, events),
			// Cancels the in-flight turn without ending the session — the web Stop
			// button. Fire-and-forget notification (ACP's `session/cancel` has no
			// reply), matching the plan's §2/T0 GUESS on the method name — see
			// docs/research/agent-config-opencode.md's ACP wire-surface table.
			interrupt(): void {
				// RC-T3: supersede the current turn and retract any pending
				// approval BEFORE notifying opencode, so a straggler `session/update`
				// or a late approval answer can never land against a turn context
				// that's already moved on — mirrors claude-code.ts's `interrupt()`.
				bumpTurnEpoch(epoch);
				retractPendingApprovals(approvals, events);
				rpc.notify("session/cancel", { sessionId });
			},
			send: opencodeSend(rpc, events, () => sessionId, epoch),
			...modeControls,
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
	},
};
