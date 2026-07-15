// Web Push port types (P3-T3, docs/local-agent-workspace-plan.md §P3-3),
// split out of ports.ts to keep that file under the repo's 300-line cap
// (same precedent as bridge-session-ports.ts / memory-ports.ts) and
// re-exported from there, so the public `@better-agent/agent/ports` surface
// is unchanged.

/** One browser push subscription a user registered from the web app. A user
 * may hold several (one per browser/device); `endpoint` is globally unique
 * per the Push API, so it doubles as the upsert key. */
export interface PushSubscriptionRow {
	auth: string;
	createdAt: Date;
	endpoint: string;
	id: string;
	p256dh: string;
	/** The subscribing browser's User-Agent header, for the owner's benefit
	 * when listing devices later. Nullable: not every client sends one. */
	userAgent: string | null;
	userId: string;
}

export interface PushSubscriptionStore {
	/** Removes the subscription with this endpoint. `userId` guards the
	 * user-initiated unsubscribe route; pass null for server-side pruning of
	 * an expired endpoint (the push service already knows it's dead — a 404/
	 * 410 from the push provider is authoritative regardless of owner). */
	deleteByEndpoint(endpoint: string, userId: string | null): Promise<void>;
	listByUser(userId: string): Promise<PushSubscriptionRow[]>;
	/** Inserts or — keyed by the globally-unique `endpoint` — replaces a
	 * subscription. Re-subscribing from the same browser (or a different user
	 * signing in on it) must not accumulate duplicate rows. */
	upsert(input: {
		auth: string;
		endpoint: string;
		p256dh: string;
		userAgent: string | null;
		userId: string;
	}): Promise<PushSubscriptionRow>;
}

/** What a single web-push notification carries — the SW (apps/web/public/
 * sw.js) parses exactly this JSON out of the push event. */
export interface PushPayload {
	body: string;
	/** Notification coalescing key (`sessionId-type`): a newer push replaces a
	 * still-displayed one for the same session+type instead of stacking. */
	tag: string;
	title: string;
	/** Deep link the SW opens on notification click (`/local/<tokenId>?session=<sessionId>`). */
	url: string;
}

/** Fans one payload out to every subscription the user holds, pruning
 * subscriptions the push provider reports gone (404/410). Implementations
 * must swallow per-endpoint send failures — a push is always best-effort. */
export interface PushSender {
	sendToUser(userId: string, payload: PushPayload): Promise<void>;
}

/** The push feature as exposed on AgentServices — null when VAPID keys are
 * not configured, which disables the whole feature fail-open. */
export interface PushService {
	sender: PushSender;
	vapidPublicKey: string;
}
