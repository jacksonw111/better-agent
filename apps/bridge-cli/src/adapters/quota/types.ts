// R4-T1's `QuotaWindow`/`QuotaSnapshot` — split out of ../types.ts purely to
// keep that file under the repo's 300-line cap; re-exported from ../types.ts
// so existing imports of it from "./types"/"../types" keep working (mirrors
// ../types.ts's own re-export of `AgentCapabilities` from
// ./agent-capabilities.ts).

/** One rate-limit window on a `QuotaSnapshot` — e.g. codex's "5小时窗口"/"本周"
 * or claude's "本次会话"/"本周"/"Opus 周"/"Sonnet 周" (see the per-provider
 * fetchers, codex-quota.ts/claude-quota.ts). */
export interface QuotaWindow {
	/** Free-form extra context that doesn't fit `usedPercent`/`resetsAt` (e.g.
	 * codex's credit balance). */
	detail?: string;
	label: string;
	resetsAt?: string;
	usedPercent: number;
}

/** The account-quota half of a `status_snapshot` (R4-T1): fetched
 * client-side, with the user's local OAuth credentials, directly against the
 * provider's own usage endpoint — never routed through (or seen by) the
 * server. Fail-open: any fetch failure (missing/malformed credentials,
 * network error, non-2xx response, timeout) yields a snapshot with an empty
 * `windows` array and `unavailableReason` set, never a thrown error — a
 * quota outage must never delay or blank out the rest of the status
 * snapshot it's attached to. */
export interface QuotaSnapshot {
	fetchedAt: string;
	plan?: string;
	provider: string;
	unavailableReason?: string;
	windows: QuotaWindow[];
}
