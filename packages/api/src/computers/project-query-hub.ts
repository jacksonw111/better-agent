import {
	PROJECT_QUERY_TIMEOUT_MS,
	type ProjectQueryOutcome,
} from "@better-agent/agent/project-ports";

// Q2: the in-memory park for real-time project queries. `projects.query`
// parks a requestId here, pushes the query frame over the computer control WS
// and awaits the parked promise; the Computer answers through
// `projects.submitQueryResult`, which resolves it. Deliberately in-process
// (same rationale as control-channel.ts's socket registry): the WS connection
// the frame travels on lives in this Node process, so the answer's oRPC call
// lands here too. Nothing is persisted — an unanswered query times out with a
// real error instead of lingering as a stale question.

interface ParkedQuery {
	/** The Computer the frame was sent to — an answer signed by any OTHER
	 * computer is refused (looks identical to an unknown requestId, no oracle). */
	computerId: string;
	settle(outcome: ProjectQueryOutcome): void;
	timer: ReturnType<typeof setTimeout>;
}

export interface ProjectQueryHub {
	/** Drops a parked query without settling it (e.g. the WS push failed
	 * before anyone could answer) — clears the timeout so nothing fires later. */
	cancel(requestId: string): void;
	/** Parks one query and resolves with the Computer's outcome, or rejects
	 * after the timeout. Park BEFORE pushing the frame so a fast answer can
	 * never race an empty map. */
	park(input: {
		computerId: string;
		requestId: string;
	}): Promise<ProjectQueryOutcome>;
	/** Settles a parked query. False — never an error — when the requestId is
	 * unknown (a late answer after timeout, a duplicate submit) or when
	 * `computerId` isn't the computer the query was sent to. */
	resolve(
		requestId: string,
		computerId: string,
		outcome: ProjectQueryOutcome
	): boolean;
}

export function createProjectQueryHub(
	options: { timeoutMs?: number } = {}
): ProjectQueryHub {
	const timeoutMs = options.timeoutMs ?? PROJECT_QUERY_TIMEOUT_MS;
	const parked = new Map<string, ParkedQuery>();
	return {
		cancel(requestId) {
			const entry = parked.get(requestId);
			if (!entry) {
				return;
			}
			clearTimeout(entry.timer);
			parked.delete(requestId);
		},
		park({ computerId, requestId }) {
			return new Promise<ProjectQueryOutcome>((resolve, reject) => {
				const timer = setTimeout(() => {
					parked.delete(requestId);
					reject(
						new Error(`project query timed out after ${timeoutMs / 1000}s`)
					);
				}, timeoutMs);
				parked.set(requestId, {
					computerId,
					settle: (outcome) => resolve(outcome),
					timer,
				});
			});
		},
		resolve(requestId, computerId, outcome) {
			const entry = parked.get(requestId);
			if (!entry || entry.computerId !== computerId) {
				return false;
			}
			clearTimeout(entry.timer);
			parked.delete(requestId);
			entry.settle(outcome);
			return true;
		},
	};
}
