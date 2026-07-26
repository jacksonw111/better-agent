import type {
	BridgeAgentKindUsage,
	BridgeUsageStore,
} from "@better-agent/agent/bridge/usage-ports";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "../schema";

type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/**
 * Per-agent-kind Local Agent usage. The PTY-terminal rewrite (spec
 * 2026-07-23) removed the structured-event pipeline and the `bridge_messages`
 * table this aggregation read `turn_usage` events from, so the Local Agent
 * sees only raw PTY bytes and has no per-kind usage to report (spec Appendix
 * A.4 #4 — local usage/quota stats cancelled). The store method is retained so
 * the `bridge.usageByAgentKind` endpoint and its web consumer keep a stable
 * shape; it now returns no rows and the web zero-fills every kind. Cloud agent
 * usage (usage-record-store) is unaffected.
 */
export function createBridgeUsageStore(_db: Db): BridgeUsageStore {
	return {
		usageByAgentKind(
			_userId: string,
			_since: Date
		): Promise<BridgeAgentKindUsage[]> {
			return Promise.resolve([]);
		},
	};
}
