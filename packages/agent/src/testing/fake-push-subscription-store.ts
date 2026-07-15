import type { PushSubscriptionRow, PushSubscriptionStore } from "../push-ports";

/** In-memory PushSubscriptionStore fake (P3-T3) for router/service tests —
 * upsert is keyed by the globally-unique endpoint, mirroring the drizzle
 * repo's `onConflictDoUpdate` on `push_subscriptions.endpoint`. */
export interface FakePushSubscriptionStore extends PushSubscriptionStore {
	/** Current rows, for assertions. */
	rows(): PushSubscriptionRow[];
}

export function createFakePushSubscriptionStore(): FakePushSubscriptionStore {
	const byEndpoint = new Map<string, PushSubscriptionRow>();
	return {
		deleteByEndpoint(endpoint, userId) {
			const row = byEndpoint.get(endpoint);
			if (row && (userId === null || row.userId === userId)) {
				byEndpoint.delete(endpoint);
			}
			return Promise.resolve();
		},
		listByUser(userId) {
			return Promise.resolve(
				[...byEndpoint.values()].filter((row) => row.userId === userId)
			);
		},
		upsert(input) {
			const existing = byEndpoint.get(input.endpoint);
			const row: PushSubscriptionRow = {
				id: existing?.id ?? crypto.randomUUID(),
				createdAt: existing?.createdAt ?? new Date(),
				...input,
			};
			byEndpoint.set(input.endpoint, row);
			return Promise.resolve(row);
		},
		rows() {
			return [...byEndpoint.values()];
		},
	};
}
