import type { BridgeTokenConfig } from "@better-agent/agent/ports";
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

/** The startup config the resumed run launches with: the model and permission
 * mode the previous run was last observed on (persisted by ingest — see
 * bridge-session-info.ts). Two things ride on this. Product-wise, continuing a
 * conversation should keep the model and mode it was being held on rather than
 * silently dropping back to the agent's defaults. Mechanically, the SDK offers
 * no way to READ either value back, so a value the CLI passes to `query()`
 * explicitly is the only kind it can report as TRUTH at startup — without it
 * the resumed session's handshake must omit both fields (the composer's menus
 * then show no selection) until claude's init line arrives, which in
 * streaming-input mode waits for the user's first turn. Returns undefined when
 * nothing was ever recorded, so a config-less token stays config-less rather
 * than being pinned to a guess. */
async function carriedStartupConfig(
	services: Services,
	run: RunRow
): Promise<BridgeTokenConfig | undefined> {
	if (!run.sessionId) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	const session = await services.stores.bridgeSession.get(run.sessionId);
	const model = session?.lastModel ?? undefined;
	const permissionMode = session?.lastPermissionMode ?? undefined;
	if (model === undefined && permissionMode === undefined) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	return { model, permissionMode };
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
			config: await carriedStartupConfig(services, latest),
			issueSnapshots: latest.issueSnapshots,
			resumeAgentSessionId: await reportedAgentSessionId(services, latest),
			task,
			workspaceKind: latest.workspaceKind,
		});
		await notifyComputerBestEffort(services, task.computerId);
		return { runId: run.id };
	});
