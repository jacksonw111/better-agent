// Split out of event-line.tsx purely to keep that file under the repo's
// 300-line limit (R5-T1's "resume_failed" entry pushed STATUS_NOTICES over) —
// re-exported from event-line.tsx so existing imports of `StatusLine` from
// there keep working (mirrors adapters/types.ts's re-export of
// `AgentCapabilities`).
import { cn } from "@better-agent/ui/lib/utils";
import type { LucideIcon } from "lucide-react";
import {
	AlertTriangleIcon,
	InfoIcon,
	PowerOffIcon,
	RotateCwIcon,
	WifiOffIcon,
} from "lucide-react";
import type { StatusEvent } from "./bridge-events";

/** How a status notice reads: `info`/`ended` are quiet asides, `warn` flags a
 * self-healing hiccup, `error` flags something the user may need to act on. */
type StatusTone = "ended" | "error" | "info" | "warn";

const TONE_CLASS: Record<StatusTone, string> = {
	ended: "text-muted-foreground",
	error: "text-destructive",
	info: "text-muted-foreground",
	warn: "text-amber-600 dark:text-amber-500",
};

interface StatusNotice {
	icon: LucideIcon;
	text: string;
	tone: StatusTone;
}

/** Wire `StatusEvent.status` -> human-readable copy, pushed by the bridge
 * CLI's own code (restart/stop/watchdog lifecycle, plus its adapters'
 * own validation/mismatch signals — never passthrough chatter from the
 * underlying agent CLI), not an agent adapter's raw session update — the
 * ONLY place these get translated. Statuses not listed here fall back to a
 * cleaned `humanizeStatus` label rather than disappearing. */
const STATUS_NOTICES: Record<string, StatusNotice> = {
	restarting: {
		icon: RotateCwIcon,
		text: "正在重启 agent…",
		tone: "warn",
	},
	restarted: {
		icon: RotateCwIcon,
		text: "agent 已重启",
		tone: "info",
	},
	stopped_by_server: {
		icon: PowerOffIcon,
		text: "会话已由服务端结束",
		tone: "ended",
	},
	agent_exited: {
		icon: PowerOffIcon,
		text: "agent 进程已退出",
		tone: "ended",
	},
	stalled: {
		icon: AlertTriangleIcon,
		text: "agent 无响应，已自动中断",
		tone: "error",
	},
	session_resumed: {
		icon: InfoIcon,
		text: "会话已恢复",
		tone: "info",
	},
	// R3-T1 Part B: pi's extension_ui_request `input`/`editor` methods (free-form
	// local text, no deny analog) are auto-cancelled on stdin the instant they
	// arrive (see apps/bridge-cli/src/adapters/pi-approvals.ts) — this status is
	// pushed alongside that cancel so the user sees WHY nothing happened instead
	// of the request just silently vanishing.
	extension_ui_auto_cancelled: {
		icon: InfoIcon,
		text: "agent 请求了本地输入（远程暂不支持），已自动取消",
		tone: "info",
	},
	// R5-T1: codex's restart-chain `thread/resume` failed (error or 2s
	// timeout) and the adapter fell back to a fresh `thread/start` — the prior
	// conversation's context is gone even though the session itself kept
	// going, so the user needs to know explicitly rather than just noticing
	// the agent "forgot" mid-conversation.
	resume_failed: {
		icon: AlertTriangleIcon,
		text: "无法恢复上下文，已开启新会话",
		tone: "warn",
	},
	// Task 13 addendum: 6 kinds the old blacklist-based `foldStatus` used to
	// render via the generic `humanizeStatus` fallback fell silently out of
	// both curated lists when that fold flipped to a whitelist (commit
	// 6e73cad) — re-admitting the 5 below (opencode-status.ts's
	// model_format_invalid, approvals.ts/questions.ts's approval/question
	// mismatches, truncate-event.ts's oversized-event marker) as proper
	// visible notices; the 6th (status_snapshot) is a hidden non-boundary —
	// see HIDDEN_STATUS_KINDS in bridge-turns.ts.
	model_format_invalid: {
		icon: AlertTriangleIcon,
		text: "模型切换失败：格式无效",
		tone: "warn",
	},
	approval_unknown: {
		icon: AlertTriangleIcon,
		text: "审批回复未能匹配到对应请求",
		tone: "warn",
	},
	approval_invalid_option: {
		icon: AlertTriangleIcon,
		text: "审批回复选项无效，未能应用",
		tone: "warn",
	},
	question_unknown: {
		icon: AlertTriangleIcon,
		text: "回复未能匹配到对应问题",
		tone: "warn",
	},
	// The DEFAULT reading of `event_truncated`: a single event whose own bytes
	// exceeded the relay cap and couldn't be shrunk (detail has no `reason` — see
	// apps/bridge-cli/src/truncate-event.ts's degradeToTruncatedStatus). The
	// backlog-overflow reading is resolved dynamically in `resolveNotice`.
	event_truncated: {
		icon: AlertTriangleIcon,
		text: "输出过长，已截断",
		tone: "warn",
	},
};

/** The `detail.reason` a backlog-overflow drop carries (never a size
 * truncation) — see apps/bridge-cli/src/forward-events-shed.ts's
 * `droppedDeltaMarker`. Kept as a literal (the CLI isn't an importable
 * workspace package — see bridge-events.ts's header). */
const PUSH_BACKLOG_OVERFLOW_REASON = "push_backlog_overflow";

/** The other reading of `event_truncated`: real-time output the CLI had to
 * DROP because its push channel to the server backed up — a network/congestion
 * story, not "too long". The text is deliberately about delivery, not size:
 * this slice of live output didn't make it through (and may be missing from
 * history too). */
const PUSH_BACKLOG_OVERFLOW_NOTICE: StatusNotice = {
	icon: WifiOffIcon,
	text: "网络拥塞，部分输出未送达",
	tone: "warn",
};

/** Pulls a string `reason` off a status event's `detail` (typed `unknown` on
 * the wire), or `undefined` when absent/non-string. */
function readDetailReason(detail: unknown): string | undefined {
	if (typeof detail === "object" && detail !== null && "reason" in detail) {
		const reason = (detail as { reason: unknown }).reason;
		if (typeof reason === "string") {
			return reason;
		}
	}
	// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
	return undefined;
}

/** Resolves the notice for an event — a plain `STATUS_NOTICES` lookup except
 * for `event_truncated`, whose copy branches on `detail.reason` so the two
 * unrelated causes (oversized event vs. dropped-under-backpressure delta) read
 * differently to the user. */
function resolveNotice(event: StatusEvent): StatusNotice | undefined {
	if (
		event.status === "event_truncated" &&
		readDetailReason(event.detail) === PUSH_BACKLOG_OVERFLOW_REASON
	) {
		return PUSH_BACKLOG_OVERFLOW_NOTICE;
	}
	return STATUS_NOTICES[event.status];
}

/** A status this table doesn't map yet: still readable, not the raw token. */
function humanizeStatus(status: string): string {
	return status.replace(/_/g, " ");
}

/** The curated set of `STATUS_NOTICES` keys — exported so `bridge-turns.ts`'s
 * `foldStatus` can whitelist EXACTLY these as visible, bubble-splitting status
 * turns. Derived from the table above (not hand-duplicated) so the two can
 * never drift apart. All 13 are pushed by the bridge CLI's own code (restart/
 * stop/watchdog/resume-fallback lifecycle, plus its adapters' own validation/
 * mismatch signals) — never passthrough of an agent adapter's raw
 * `sessionUpdate` kind — which is what makes them safe to special-case: unlike
 * unrecognized adapter chatter, no third-party agent build can silently add a
 * 14th one. */
export const STATUS_NOTICE_KINDS: ReadonlySet<string> = new Set(
	Object.keys(STATUS_NOTICES)
);

export function StatusLine({ event }: { event: StatusEvent }) {
	const notice = resolveNotice(event);
	const Icon = notice?.icon ?? InfoIcon;
	const tone = notice?.tone ?? "info";
	const text = notice?.text ?? humanizeStatus(event.status);
	const toneClass = TONE_CLASS[tone];
	return (
		<p className={cn("flex items-center gap-1.5", toneClass)}>
			<Icon className="size-3.5 shrink-0" />
			{text}
		</p>
	);
}
