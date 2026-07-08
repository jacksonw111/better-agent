import type { UsageRecordStore } from "../ports";
import type { UsageSnapshot } from "../usage/usage-record";

/** Captures every inserted snapshot in call order; `insert` never throws. */
export function createFakeUsageRecordStore(): UsageRecordStore & {
	inserted: UsageSnapshot[];
} {
	const inserted: UsageSnapshot[] = [];
	return {
		inserted,
		insert(snapshot) {
			inserted.push(snapshot);
			return Promise.resolve();
		},
	};
}
