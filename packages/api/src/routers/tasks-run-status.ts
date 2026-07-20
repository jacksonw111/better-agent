import type { BridgeSessionRow } from "@better-agent/agent/ports";
import {
	type RunRow,
	TERMINAL_RUN_STATUSES,
} from "@better-agent/agent/task-ports";
import type { Context } from "../context";

// Effective run status on the read path (run-status reconcile bugfix). A
// non-terminal runs.status can go stale because the client is the only writer
// of terminal reports: when its process is killed or the machine drops off
// the network, no `stopped` ever arrives and the session lists show the run
// as live forever. tasks.list / tasks.get therefore reconcile on read: a
// non-terminal run is presumed dead once (a) its computer has been
// heartbeat-silent past RUN_STALE_OFFLINE_GRACE_MS or (b) its bound bridge
// session is over. The correction is written back rather than projected only
// into the response, so the runs table stays the single source of truth —
// later reads take the terminal fast path, and the resume/retry gates (which
// read runs.status directly) agree with what the user was shown.

type Services = Context["services"];

/** How long a computer may be heartbeat-silent before its non-terminal runs
 * are presumed dead. Deliberately wider than COMPUTER_OFFLINE_AFTER_MS (30s,
 * the UI's offline badge) so one missed heartbeat never flips a run that is
 * actually fine — only a computer well past offline does. */
export const RUN_STALE_OFFLINE_GRACE_MS = 60_000;

/** The liveness facts the orphan test needs, decoupled from HOW they were
 * fetched — per-run store reads on the tasks.list/get path, or columns of the
 * single joined active-session query (tasks-active.ts). */
export interface RunLivenessInputs {
	/** Null when the computer row is gone — nobody can report anything. */
	computerLastSeenAt: Date | null;
	/** Whether the run ever bound a bridge session. A run with no binding is
	 * judged purely on its computer's heartbeat (it may still be launching). */
	hasSessionBinding: boolean;
	nowMs: number;
	/** Null when the bound session row is missing (hard-deleted out from under
	 * the run, leaving a dangling sessionId) — the same as ended, for the
	 * purposes of "is anyone still reporting?". */
	sessionStatus: "active" | "ended" | null;
}

/** True when nobody is left to report this run's real status: its bound
 * bridge session is over (ended — or hard-deleted from under it, leaving a
 * dangling sessionId), or its computer stopped heartbeating past the grace
 * window (client killed, network gone, machine off — or the row deleted).
 *
 * Pure and exported so every read path judges liveness identically — a second
 * implementation is how a dead session ends up advertised as live. */
export function isRunPresumedDead(inputs: RunLivenessInputs): boolean {
	if (inputs.hasSessionBinding && inputs.sessionStatus !== "active") {
		return true;
	}
	if (!inputs.computerLastSeenAt) {
		return true;
	}
	return (
		inputs.nowMs - inputs.computerLastSeenAt.getTime() >
		RUN_STALE_OFFLINE_GRACE_MS
	);
}

async function isRunOrphaned(
	services: Services,
	run: RunRow,
	session: BridgeSessionRow | null
): Promise<boolean> {
	const computer = await services.stores.computer.getById(run.computerId);
	return isRunPresumedDead({
		computerLastSeenAt: computer?.lastSeenAt ?? null,
		hasSessionBinding: Boolean(run.sessionId),
		nowMs: Date.now(),
		sessionStatus: session?.status ?? null,
	});
}

/** The run as the read path should present it, plus its bound session row
 * (tasks.list needs it for hasAgentSessionId, tasks.get returns it whole).
 * An orphaned non-terminal run is reconciled to `stopped` AND persisted —
 * see the module comment for why write-back beats a response-only fix. */
export async function reconciledRunWithSession(
	services: Services,
	run: RunRow
): Promise<{ run: RunRow; session: BridgeSessionRow | null }> {
	const session = run.sessionId
		? await services.stores.bridgeSession.get(run.sessionId)
		: null;
	if (
		TERMINAL_RUN_STATUSES.has(run.status) ||
		!(await isRunOrphaned(services, run, session))
	) {
		return { run, session };
	}
	await services.stores.run.updateStatus(run.id, { status: "stopped" });
	return { run: { ...run, status: "stopped" }, session };
}
