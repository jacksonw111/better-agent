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

export const runsRouter = {
	ackLaunch,
};
