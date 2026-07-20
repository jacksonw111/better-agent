import { z } from "zod";
import { requireOwnedBridgeSession } from "../bridge/ownership";
import { userProcedure } from "../index";
import { assertInputWithinSizeLimit } from "./bridge-size-limits";

// fix-send-outbox: split out of bridge.ts purely to keep that file under the
// repo's max-lines-per-file gate.

/** Hard cap on `sendInput`'s optional `idempotencyKey` — comfortably above a
 * UUID (the web outbox mints `crypto.randomUUID()`), while keeping an
 * arbitrary client from parking megabyte-sized keys in the relay's dedup map. */
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

/**
 * fix-send-outbox: `idempotencyKey` is the browser's client-minted key for
 * this send (see `apps/web/src/components/bridge/send-outbox.ts`), stable
 * across the outbox's retries of the same message. `relayStore.append`
 * dedups on (sessionId, "commands", key), so a retry that follows a send
 * the server actually received — but whose response was lost in flight —
 * queues the command exactly once instead of typing the user's message (or
 * replaying an approval decision) into the agent twice.
 *
 * Optional, and omitting it is byte-identical to the pre-outbox behavior
 * (always append) — older web builds and any other client keep working
 * unchanged.
 *
 * The dedup window is the relay channel's IN-MEMORY MAX_WINDOW ring (see
 * relay-store.ts), not a durable store: deliberate, since the relay itself
 * is in-memory single-instance, so a key can only outlive its window by
 * outliving the events it dedupes against. A process restart drops the
 * window and the commands alongside it, so there is nothing left to
 * double-deliver.
 */
export const sendInput = userProcedure
	.input(
		z.object({
			sessionId: z.uuid(),
			data: z.unknown(),
			idempotencyKey: z
				.string()
				.min(1)
				.max(MAX_IDEMPOTENCY_KEY_LENGTH)
				.optional(),
		})
	)
	.handler(async ({ input, context }) => {
		await requireOwnedBridgeSession(
			context,
			context.authedUser.id,
			input.sessionId
		);
		assertInputWithinSizeLimit(input.data);
		const { isNew } = await context.services.relayStore.append(
			input.sessionId,
			"commands",
			input.data,
			input.idempotencyKey
		);
		// A deduped resend queued nothing new, so there is nothing to wake the
		// CLI's long-poll for.
		if (isNew) {
			context.services.commandBus.notify(input.sessionId);
		}
		return { ok: true };
	});
