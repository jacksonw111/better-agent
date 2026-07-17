import type { RunRow } from "@better-agent/agent/task-ports";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import type { Context } from "../context";
import { authorizedUserProcedure } from "../index";
import { appendRun } from "./tasks-append-run";
import {
	notifyComputerBestEffort,
	requireOnlineOwnedComputer,
} from "./tasks-guards";

// tasks.resume (P1): reopening a session. Product-wise a session IS a Task,
// so "continue this conversation" = append a NEW sequential Run that launches
// with the previous run's runtime conversation id (the bound bridge session's
// agentSessionId) for a native resume in the SAME task workspace. Unlike
// retry (§16, cold restart with refreshed snapshots), resume carries the
// finished run's snapshots forward verbatim — the conversation already saw
// them, and the point is continuity, not a fresh launch context.

type Services = Context["services"];

/** Resume only continues a settled conversation: any pre-terminal status
 * means the session is still live on the computer, so no second Run. */
const RESUMABLE_STATUSES: ReadonlySet<RunRow["status"]> = new Set([
	"failed",
	"stopped",
	"completed",
]);

/** The previous run's runtime conversation id, or null when the runtime never
 * reported one (or no session was ever bound) — a null resumes as a cold
 * start of the same workspace, the closest available continuation. */
async function reportedAgentSessionId(
	services: Services,
	run: RunRow
): Promise<string | null> {
	if (!run.sessionId) {
		return null;
	}
	const session = await services.stores.bridgeSession.get(run.sessionId);
	return session?.agentSessionId ?? null;
}

export const resume = authorizedUserProcedure
	.input(z.object({ taskId: z.uuid() }))
	.handler(async ({ input, context }) => {
		const { services } = context;
		const task = await services.stores.task.getById(
			input.taskId,
			context.authedUser.id
		);
		if (!task) {
			throw new ORPCError("NOT_FOUND", { message: "Task not found" });
		}
		const latest = await services.stores.run.latestByTask(task.id);
		if (!(latest && RESUMABLE_STATUSES.has(latest.status))) {
			throw new ORPCError("PRECONDITION_FAILED", {
				message:
					"This session is still running — stop it before resuming a new run",
			});
		}
		await requireOnlineOwnedComputer(
			services,
			context.authedUser.id,
			task.computerId
		);
		const run = await appendRun(services, {
			issueSnapshots: latest.issueSnapshots,
			resumeAgentSessionId: await reportedAgentSessionId(services, latest),
			task,
			workspaceKind: latest.workspaceKind,
		});
		await notifyComputerBestEffort(services, task.computerId);
		return { runId: run.id };
	});
