import { relativeTime } from "@/utils/relative-time";
import type { QuotaSnapshot, QuotaWindow } from "./bridge-status-snapshot";
import { clampPct } from "./bridge-usage-format";

// R4-T2: the "Account quota" section of the Status popover, split out of
// status-snapshot-panel.tsx purely to keep that file under the repo's
// 300-line cap. Renders R4-T1's `QuotaSnapshot` (the account's plan/
// rate-limit windows, fetched CLI-side with the user's local OAuth
// credentials — see fetchCodexQuota/fetchClaudeQuota in bridge-cli).

const PERCENT_MAX = 100;

/** Small uppercase label shared by every section of the Status popover
 * (Account quota / This session / MCP) — kept here since this is the first
 * section that needed one, re-exported for the others. */
export function StatusSectionHeader({ title }: { title: string }) {
	return (
		<span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
			{title}
		</span>
	);
}

/** "剩余 62% · 2小时后重置 · Balance: 50" — the REMAINING-percent
 * inversion (hermes's own render style): a `QuotaWindow` carries
 * `usedPercent`, but "you've used 62%" buries the number a user actually
 * wants at a glance ("how much do I have left"), so the text reads the
 * complement while the bar underneath still fills by the raw `usedPercent`
 * (the same "fill = consumed" visual language as the context-usage bar).
 * Chinese copy is mandated by docs/local-agent-refactor-plan.md §4.4
 * ("剩余x%·y后重置") — matching R4-T1's zh window labels. */
function windowRemainingText(window: QuotaWindow): string {
	const remaining = Math.round(clampPct(PERCENT_MAX - window.usedPercent));
	const parts = [`剩余 ${remaining}%`];
	if (window.resetsAt) {
		parts.push(`${relativeTime(window.resetsAt, "zh-CN")}重置`);
	}
	if (window.detail) {
		parts.push(window.detail);
	}
	return parts.join(" · ");
}

function QuotaWindowRow({ window }: { window: QuotaWindow }) {
	return (
		<div className="flex flex-col gap-1">
			<span className="text-xs">{window.label}</span>
			<div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
				<div
					className="h-full rounded-full bg-primary"
					style={{ width: `${clampPct(window.usedPercent)}%` }}
				/>
			</div>
			<span className="text-muted-foreground text-xs tabular-nums">
				{windowRemainingText(window)}
			</span>
		</div>
	);
}

export function QuotaSection({ quota }: { quota: QuotaSnapshot | undefined }) {
	if (!quota) {
		return null;
	}
	if (quota.windows.length === 0 && !quota.unavailableReason) {
		return null;
	}
	return (
		<div className="flex flex-col gap-2">
			<StatusSectionHeader title="账号配额" />
			{quota.unavailableReason ? (
				<p className="text-muted-foreground text-xs">
					配额信息不可用（{quota.unavailableReason}）
				</p>
			) : (
				<div className="flex flex-col gap-2.5">
					{quota.windows.map((window) => (
						<QuotaWindowRow key={window.label} window={window} />
					))}
				</div>
			)}
			<span className="text-muted-foreground text-xs">
				更新于{relativeTime(quota.fetchedAt, "zh-CN")}
			</span>
		</div>
	);
}
