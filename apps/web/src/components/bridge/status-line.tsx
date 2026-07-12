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
 * CLI's own lifecycle (restart/stop/watchdog), not an agent adapter — the
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
};

/** A status this table doesn't map yet: still readable, not the raw token. */
function humanizeStatus(status: string): string {
	return status.replace(/_/g, " ");
}

/** The curated set of `STATUS_NOTICES` keys — exported so `bridge-turns.ts`'s
 * `foldStatus` can whitelist EXACTLY these as visible, bubble-splitting status
 * turns. Derived from the table above (not hand-duplicated) so the two can
 * never drift apart. All 8 are pushed by the bridge CLI's own lifecycle
 * (restart/stop/watchdog/resume-fallback) — never by an agent adapter — which
 * is what makes them safe to special-case: unlike an adapter's `sessionUpdate`
 * kind, no third-party agent build can silently add a 9th one. */
export const STATUS_NOTICE_KINDS: ReadonlySet<string> = new Set(
	Object.keys(STATUS_NOTICES)
);

export function StatusLine({ event }: { event: StatusEvent }) {
	const notice = STATUS_NOTICES[event.status];
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
