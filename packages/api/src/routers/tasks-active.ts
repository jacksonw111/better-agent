import type { BridgeAgentKind } from "@better-agent/agent/ports";
import type { ActiveSessionRow } from "@better-agent/agent/task/active-session-ports";
import type { RunStatus } from "@better-agent/agent/task-ports";
import {
	isAttentionEligible,
	readSessionAttention,
} from "../bridge/read-attention";
import type { Context } from "../context";
import { authorizedUserProcedure } from "../index";
import { isRunPresumedDead } from "./tasks-run-status";

// tasks.listActive — the global view of the multi-session model.
//
// A session is a long-lived unit of work: navigating away from the page does
// not end it, and nothing but an explicit `bridge.endSession` settles it. That
// is exactly what makes this endpoint necessary — with several sessions
// running at once across several computers and projects, the user otherwise
// has no way to see which are still working and which are blocked waiting on
// an answer from them.
//
// Two correctness rules it must not get wrong:
//  1. Liveness is NOT just `runs.status`. The client is the only writer of
//     terminal reports, so a killed process or a machine off the network
//     leaves a non-terminal row forever. This reuses tasks-run-status.ts's
//     reconcile — same predicate, same grace window, same write-back — so a
//     dead session is never advertised as live.
//  2. "Needs attention" reuses the session-attention fold behind
//     bridge.listSessions (../bridge/read-attention.ts), so the global view
//     and the sidebar can never disagree about whether a session is blocked.

type Services = Context["services"];

/** Wire shape of one active session. Dates are ISO strings: this is a polled
 * list the web sorts and renders directly. */
interface ActiveSessionEntry {
	agentKind: BridgeAgentKind;
	computerId: string;
	computerName: string;
	lastActivityAt: string;
	name: string;
	needsAttention: boolean;
	projectId: string | null;
	projectName: string | null;
	runId: string;
	/** Always a non-terminal RunStatus — a terminal one would not be listed. */
	status: RunStatus;
	taskId: string;
}

/** The freshest evidence that this session did something: its bound bridge
 * session's last poll/WS contact, falling back to the run row's own
 * `updatedAt` for a run that has not bound a session yet (still launching). */
function lastActivityAt(row: ActiveSessionRow): Date {
	return row.sessionLastSeenAt ?? row.updatedAt;
}

/** Whether the run is genuinely alive, reusing the shared stale-run predicate.
 * A presumed-dead run is ALSO written back to `stopped` (reconcile-on-read,
 * as on tasks.list/get) so the runs table stays the single source of truth and
 * later reads take the terminal fast path. */
async function isLive(
	services: Services,
	row: ActiveSessionRow,
	nowMs: number
): Promise<boolean> {
	const dead = isRunPresumedDead({
		computerLastSeenAt: row.computerLastSeenAt,
		hasSessionBinding: Boolean(row.sessionId),
		nowMs,
		sessionStatus: row.sessionStatus,
	});
	if (!dead) {
		return true;
	}
	await services.stores.run.updateStatus(row.runId, { status: "stopped" });
	return false;
}

/** Is this session waiting on the user right now? Either the runtime reported
 * `waiting_for_user`, or an approval/question is still open and unanswered.
 * A session that is merely working ("processing") is NOT attention — the
 * whole point of the flag is "you are the blocker". */
async function needsAttention(
	services: Services,
	row: ActiveSessionRow,
	nowMs: number
): Promise<boolean> {
	if (row.runStatus === "waiting_for_user") {
		return true;
	}
	const eligible = isAttentionEligible(
		row.sessionId && row.sessionLastSeenAt && row.sessionStatus
			? { lastSeenAt: row.sessionLastSeenAt, status: row.sessionStatus }
			: null,
		nowMs
	);
	if (!(eligible && row.sessionId)) {
		return false;
	}
	return (
		(await readSessionAttention(services.relayStore, row.sessionId)) ===
		"approval"
	);
}

async function toEntry(
	services: Services,
	row: ActiveSessionRow,
	nowMs: number
): Promise<ActiveSessionEntry> {
	return {
		agentKind: row.agentKind,
		computerId: row.computerId,
		computerName: row.computerName,
		lastActivityAt: lastActivityAt(row).toISOString(),
		name: row.taskName,
		needsAttention: await needsAttention(services, row, nowMs),
		projectId: row.projectId,
		projectName: row.projectName,
		runId: row.runId,
		status: row.runStatus,
		taskId: row.taskId,
	};
}

/** Every session of the caller that is still alive — across all computers and
 * projects — newest activity first. */
export const listActive = authorizedUserProcedure.handler(
	async ({ context }) => {
		const { services } = context;
		const rows = await services.stores.activeSession.listActiveByUser(
			context.authedUser.id
		);
		const nowMs = Date.now();
		const live = await Promise.all(
			rows.map(async (row) =>
				(await isLive(services, row, nowMs)) ? row : null
			)
		);
		const sessions = await Promise.all(
			live
				.filter((row): row is ActiveSessionRow => row !== null)
				.map((row) => toEntry(services, row, nowMs))
		);
		sessions.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
		return { sessions };
	}
);
