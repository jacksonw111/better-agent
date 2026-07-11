import { Badge } from "@better-agent/ui/components/badge";
import { Button } from "@better-agent/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@better-agent/ui/components/card";
import { cn } from "@better-agent/ui/lib/utils";
import type { LucideIcon } from "lucide-react";
import {
	AlertTriangleIcon,
	CheckIcon,
	FileEditIcon,
	InfoIcon,
	PowerOffIcon,
	RotateCwIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import type {
	ApprovalEvent,
	ErrorEvent,
	FileEvent,
	StatusEvent,
} from "./bridge-events";

const DEFAULT_OPTION_INDEX = 0;

const FILE_CHANGE_LABEL: Record<FileEvent["change"], string> = {
	created: "+",
	modified: "~",
	deleted: "-",
};

export function FileLine({ event }: { event: FileEvent }) {
	return (
		<p className="flex items-center gap-1.5">
			<FileEditIcon className="size-3.5 shrink-0 text-muted-foreground" />
			<Badge variant="outline">
				{FILE_CHANGE_LABEL[event.change]} {event.path}
			</Badge>
		</p>
	);
}

/** How a status notice reads: `info`/`ended` are quiet asides, `warn` flags a
 * self-healing hiccup (a retry/restart in progress), `error` flags something
 * the user may need to act on (the agent gave up and needs re-poking). */
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

/** Wire `StatusEvent.status` -> human-readable copy, pushed straight to the
 * server by the bridge CLI's own lifecycle (restart/stop/watchdog — see
 * `apps/bridge-cli/src/command-outcome.ts` and `session-watchdog.ts`), not by
 * an agent adapter, so these never carry curated Chinese copy of their own —
 * this is the ONLY place they get translated for the chat feed. Statuses NOT
 * listed here (a status this table hasn't caught up to yet, or an adapter's
 * own passthrough status) fall back to a cleaned `humanizeStatus` label
 * rather than disappearing. */
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
};

/** A status this table doesn't map yet: still readable (underscores become
 * spaces) instead of showing the raw wire token verbatim. */
function humanizeStatus(status: string): string {
	return status.replace(/_/g, " ");
}

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

export function ErrorLine({ event }: { event: ErrorEvent }) {
	return (
		<p className="flex items-center gap-1.5 text-destructive">
			<AlertTriangleIcon className="size-3.5 shrink-0" />
			{event.message}
		</p>
	);
}

export interface ApprovalLineProps {
	answeredOptionId?: string;
	event: ApprovalEvent;
	onAnswer?: (requestId: string, optionId: string) => void;
}

/** R3-T2: `true` once wall-clock has passed `timeoutAt` — the CLI's
 * `presentApproval` (`apps/bridge-cli/src/adapters/approvals.ts`) resolves
 * declined and pushes a real "Timed out — declined" event around then, so
 * this local flag is purely cosmetic: it swaps the shrinking bar for expiry
 * copy a little before that server-pushed event lands. */
function useApprovalExpired(timeoutAt: number): boolean {
	const [expired, setExpired] = useState(() => timeoutAt <= Date.now());
	useEffect(() => {
		if (expired) {
			return () => {
				// nothing to clean up: no timer was armed
			};
		}
		const timer = setTimeout(() => setExpired(true), timeoutAt - Date.now());
		return () => clearTimeout(timer);
	}, [timeoutAt, expired]);
	return expired;
}

/** A thin bar that visually shrinks from full to empty between mount and
 * `timeoutAt`, or "已超时，按拒绝处理" once that time has passed. The width
 * transition is triggered by flipping `shrink` a frame after mount (so the
 * initial full-width paint isn't itself animated) — no Tailwind arbitrary
 * values, so the duration/width are set via inline style instead of a
 * `transition-[width]` class. */
function ApprovalCountdown({ timeoutAt }: { timeoutAt: number }) {
	const expired = useApprovalExpired(timeoutAt);
	const [shrink, setShrink] = useState(false);
	useEffect(() => {
		const raf = requestAnimationFrame(() => setShrink(true));
		return () => cancelAnimationFrame(raf);
	}, []);

	if (expired) {
		return (
			<p
				className="px-4 text-destructive text-xs group-data-[size=sm]/card:px-3"
				data-slot="approval-countdown-expired"
			>
				已超时，按拒绝处理
			</p>
		);
	}
	return (
		<div
			className="mx-4 h-1 overflow-hidden rounded-full bg-muted group-data-[size=sm]/card:mx-3"
			data-slot="approval-countdown"
		>
			<div
				className="h-full bg-primary"
				data-slot="approval-countdown-fill"
				style={{
					transitionDuration: `${Math.max(timeoutAt - Date.now(), 0)}ms`,
					transitionProperty: "width",
					transitionTimingFunction: "linear",
					width: shrink ? "0%" : "100%",
				}}
			/>
		</div>
	);
}

/**
 * Approval request card: title + optional detail + one button per option.
 * The first option is the "allow"-style default action, the rest render as
 * outline buttons. Once `answeredOptionId` is set — either from this
 * session's own click (optimistically, before the round trip settles — see
 * `makeAnswerApproval`) or a replayed event for an already-answered
 * `requestId` — THIS card's buttons disable and the chosen one shows a check.
 * Disabling is per-card (keyed by `requestId`), deliberately NOT gated on the
 * connection's global "sending" flag: that flag flips for any send, so gating
 * on it greyed out every open approval card when the user answered one.
 *
 * R3-T2: below the header, an optional muted `summary` line (codex fileChange
 * requests only, for now) and an optional countdown bar/expiry notice driven
 * by `timeoutAt` — both additive fields, absent for other adapters/requests.
 */
export function ApprovalLine({
	answeredOptionId,
	event,
	onAnswer,
}: ApprovalLineProps) {
	const disabled = answeredOptionId !== undefined;
	return (
		<Card className="gap-2 font-sans" size="sm">
			<CardHeader>
				<CardTitle>{event.title}</CardTitle>
				{event.detail && <CardDescription>{event.detail}</CardDescription>}
			</CardHeader>
			{event.summary && (
				<p
					className="px-4 text-muted-foreground text-xs group-data-[size=sm]/card:px-3"
					data-slot="approval-summary"
				>
					{event.summary}
				</p>
			)}
			{event.timeoutAt !== undefined && !disabled && (
				<ApprovalCountdown timeoutAt={event.timeoutAt} />
			)}
			<CardContent className="flex flex-wrap gap-2">
				{event.options.map((option, index) => {
					const chosen = answeredOptionId === option.id;
					return (
						<Button
							disabled={disabled}
							key={option.id}
							onClick={() => onAnswer?.(event.requestId, option.id)}
							size="sm"
							type="button"
							variant={index === DEFAULT_OPTION_INDEX ? "default" : "outline"}
						>
							{chosen && <CheckIcon className="size-3.5" />}
							{option.label}
							{chosen && <span className="sr-only"> (chosen)</span>}
						</Button>
					);
				})}
			</CardContent>
		</Card>
	);
}
