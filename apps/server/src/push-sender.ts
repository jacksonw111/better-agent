import type {
	PushService,
	PushSubscriptionRow,
	PushSubscriptionStore,
} from "@better-agent/agent/ports";
import { env } from "@better-agent/env/server";
import { log } from "evlog";
import webpush from "web-push";

// P3-T3: the Node-side PushSender behind AgentServices.push. The `web-push`
// npm package (VAPID signing + payload encryption) only runs on a long-lived
// Node process, which this server is — packages/api stays runtime-agnostic
// and only sees the PushSender port, mirroring how the attachment store's
// bucket is injected from here.

/** Push-provider statuses that mean "this subscription no longer exists"
 * (unsubscribed or expired) — the row is pruned, not retried. */
const HTTP_NOT_FOUND = 404;
const HTTP_GONE = 410;
const SUBSCRIPTION_GONE_STATUSES = new Set([HTTP_NOT_FOUND, HTTP_GONE]);

/** Sends one payload to one subscription, pruning it when the provider says
 * it's gone and logging (never throwing) on any other failure — one dead or
 * flaky endpoint must not stop the fan-out to the user's other devices. */
async function sendToSubscription(
	store: PushSubscriptionStore,
	subscription: PushSubscriptionRow,
	body: string
): Promise<void> {
	try {
		await webpush.sendNotification(
			{
				endpoint: subscription.endpoint,
				keys: { p256dh: subscription.p256dh, auth: subscription.auth },
			},
			body
		);
	} catch (err) {
		const statusCode = (err as { statusCode?: number }).statusCode;
		if (
			statusCode !== undefined &&
			SUBSCRIPTION_GONE_STATUSES.has(statusCode)
		) {
			await store.deleteByEndpoint(subscription.endpoint, null);
			return;
		}
		log.warn({
			action: "web push send",
			endpoint: subscription.endpoint,
			error: String(err),
		});
	}
}

/**
 * The push feature, or null when the VAPID keypair is not configured — which
 * disables it fail-open across the app (subscribe routes error clearly, the
 * ingest notify hook no-ops). Generate keys with
 * `npx web-push generate-vapid-keys`.
 */
export function buildPushService(
	subscriptions: PushSubscriptionStore
): PushService | null {
	const publicKey = env.VAPID_PUBLIC_KEY;
	const privateKey = env.VAPID_PRIVATE_KEY;
	if (!(publicKey && privateKey)) {
		return null;
	}
	webpush.setVapidDetails(env.VAPID_SUBJECT, publicKey, privateKey);
	return {
		vapidPublicKey: publicKey,
		sender: {
			async sendToUser(userId, payload) {
				const rows = await subscriptions.listByUser(userId);
				const body = JSON.stringify(payload);
				await Promise.all(
					rows.map((row) => sendToSubscription(subscriptions, row, body))
				);
			},
		},
	};
}
