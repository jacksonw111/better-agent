import {
	type RunStatus,
	TERMINAL_RUN_STATUSES,
} from "@better-agent/agent/task-ports";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { computerProcedure } from "../index";

// Runs router (S2-T2). `ackLaunch` is the client's single ack path for a
// delivered Launch Command — the same oRPC call whether the command arrived
// over /computer-ws or as heartbeat pendingCommands. The ack moves the Run
// out of `created`, which is what removes it from the pending queue (the
// queue IS the created-runs set, see ../computers/pending-commands.ts), so
// launch delivery stays idempotent per Run id (master spec §15.3).

const ackLaunch = computerProcedure
	.input(z.object({ runId: z.uuid() }))
	.handler(async ({ input, context }) => {
		const run = await context.services.stores.run.getByIdForComputer(
			input.runId,
			context.computer.id
		);
		// Unknown AND someone-else's-computer look identical — no oracle.
		if (!run) {
			throw new ORPCError("NOT_FOUND", { message: "Run not found" });
		}
		// Already past `created` (a duplicate ack after redelivery): idempotent
		// ok:false, never an error — the client just skips the launch.
		if (run.status !== "created") {
			return { ok: false };
		}
		await context.services.stores.run.updateStatus(run.id, {
			status: "launching",
		});
		return { ok: true };
	});

// S2-T3: runs.updateStatus — the client's Run progress reports (§11.2).
// Transitions are forward-only along the §11.2 chain; failed/stopped/completed
// are terminal. Ranks come from the array index so the ordering is data, not
// magic numbers; the three terminal statuses share the past-the-end rank.
const FORWARD_STATUS_ORDER: readonly RunStatus[] = [
	"created",
	"launching",
	"preparing_workspace",
	"starting_runtime",
	"running",
	"waiting_for_user",
];

// Everything a client may report — `created` is server-only and `launching`
// belongs to ackLaunch above.
const REPORTABLE_STATUSES = [
	"preparing_workspace",
	"starting_runtime",
	"running",
	"waiting_for_user",
	"completed",
	"stopped",
	"failed",
] as const;
const ERROR_MESSAGE_MAX_LENGTH = 10_000;
const WORKSPACE_PATH_MAX_LENGTH = 1024;

function statusRank(status: RunStatus): number {
	const index = FORWARD_STATUS_ORDER.indexOf(status);
	return index === -1 ? FORWARD_STATUS_ORDER.length : index;
}

function isForwardTransition(current: RunStatus, next: RunStatus): boolean {
	if (TERMINAL_RUN_STATUSES.has(current)) {
		return false;
	}
	return statusRank(next) > statusRank(current);
}

const updateStatus = computerProcedure
	.input(
		z.object({
			// The REAL error (§16) — recorded verbatim, never synthesized.
			errorMessage: z.string().max(ERROR_MESSAGE_MAX_LENGTH).optional(),
			runId: z.uuid(),
			status: z.enum(REPORTABLE_STATUSES).optional(),
			workspacePath: z.string().max(WORKSPACE_PATH_MAX_LENGTH).optional(),
		})
	)
	.handler(async ({ input, context }) => {
		const run = await context.services.stores.run.getByIdForComputer(
			input.runId,
			context.computer.id
		);
		if (!run) {
			throw new ORPCError("NOT_FOUND", { message: "Run not found" });
		}
		// Illegal (backwards or out-of-terminal) transition: idempotent ok:false,
		// never an error, and the row stays untouched.
		if (input.status && !isForwardTransition(run.status, input.status)) {
			return { ok: false };
		}
		await context.services.stores.run.updateStatus(run.id, {
			errorMessage: input.errorMessage,
			status: input.status,
			workspacePath: input.workspacePath,
		});
		return { ok: true };
	});

export const runsRouter = {
	ackLaunch,
	updateStatus,
};
