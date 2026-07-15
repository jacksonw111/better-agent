import type { PushService } from "@better-agent/agent/ports";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import type { Context } from "../context";
import { userProcedure } from "../index";

// P3-T3 (docs/local-agent-workspace-plan.md §P3-3): user-plane Web Push
// subscription management. The VAPID public key is served from here (not a
// VITE_ build-time var) so rotating the keypair never requires a web rebuild
// — the browser fetches the current key right before subscribing.

/** The push feature when configured, or a clear error when the server has no
 * VAPID keypair — the web disables its switch off `vapidPublicKey()` first,
 * so hitting this is a race/stale-client case, not a normal path. */
function requirePush(context: Context): PushService {
	const push = context.services.push;
	if (!push) {
		throw new ORPCError("SERVICE_UNAVAILABLE", {
			message: "Web Push is unavailable (VAPID keys not configured)",
		});
	}
	return push;
}

const subscribeInput = z.object({
	endpoint: z.url(),
	keys: z.object({
		p256dh: z.string().min(1),
		auth: z.string().min(1),
	}),
});

export const pushSubscriptionsRouter = {
	/** The server's current VAPID public key, or null when push is disabled —
	 * the web uses null to render its notifications switch disabled. */
	vapidPublicKey: userProcedure.handler(({ context }) => ({
		key: context.services.push?.vapidPublicKey ?? null,
	})),

	/** Registers (or, keyed by the globally-unique endpoint, replaces) this
	 * browser's push subscription for the signed-in user. */
	subscribe: userProcedure
		.input(subscribeInput)
		.handler(async ({ input, context }) => {
			requirePush(context);
			await context.services.stores.pushSubscription.upsert({
				userId: context.authedUser.id,
				endpoint: input.endpoint,
				p256dh: input.keys.p256dh,
				auth: input.keys.auth,
				userAgent: context.userAgent,
			});
			return { ok: true };
		}),

	/** Drops this browser's subscription (owner-guarded). Deliberately NOT
	 * gated on `requirePush`: a user must be able to clean up even after the
	 * server's VAPID keys were removed. */
	unsubscribe: userProcedure
		.input(z.object({ endpoint: z.url() }))
		.handler(async ({ input, context }) => {
			await context.services.stores.pushSubscription.deleteByEndpoint(
				input.endpoint,
				context.authedUser.id
			);
			return { ok: true };
		}),
};
