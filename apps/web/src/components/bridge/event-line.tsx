import { Badge } from "@better-agent/ui/components/badge";
import { Button } from "@better-agent/ui/components/button";
import { AlertTriangleIcon, CheckIcon, FileEditIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { ApprovalEvent, ErrorEvent, FileEvent } from "./bridge-events";

// `StatusLine` (+ the STATUS_NOTICES map it reads) moved to status-line.tsx
// purely to keep this file under the repo's 300-line limit — import it from
// there directly (not re-exported here: biome's noBarrelFile flags a
// value re-export).

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
 * `presentApproval` resolves declined and pushes a real "Timed out —
 * declined" event around then, so this flag is purely cosmetic: it swaps the
 * shrinking bar for expiry copy a little before that event lands. */
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

/** R3-4 review finding 4: the window `timeoutAt` was computed from, used only
 * for an event that predates `timeoutMs` (an older CLI). Mirrors bridge-cli's
 * `APPROVAL_TIMEOUT_MS` — keep the two in sync. */
const DEFAULT_APPROVAL_WINDOW_MS = 5 * 60_000;

const FULL_WIDTH_PERCENT = 100;
const EMPTY_WIDTH_PERCENT = 0;

/** Bar width % for remaining/total, clamped to `[0, 100]`. */
function countdownWidthPercent(remainingMs: number, totalMs: number): number {
	if (totalMs <= 0) {
		return FULL_WIDTH_PERCENT;
	}
	const fraction = (remainingMs / totalMs) * FULL_WIDTH_PERCENT;
	return Math.min(FULL_WIDTH_PERCENT, Math.max(EMPTY_WIDTH_PERCENT, fraction));
}

/** A thin bar that visually shrinks from its current fill to empty between
 * mount and `timeoutAt`, or "已超时，按拒绝处理" once that time has passed.
 * `shrink` flips a frame after mount so the initial paint isn't itself
 * animated; duration/width are inline style since there's no Tailwind
 * arbitrary `transition-[width]` class.
 *
 * R3-4 review finding 4: the initial (pre-shrink) width is the REMAINING
 * fraction of `timeoutMs` (falling back to `DEFAULT_APPROVAL_WINDOW_MS`), not
 * a hardcoded 100% — otherwise a remount mid-window (e.g. a page reload while
 * a card is still pending) redraws a full bar despite elapsed time. */
function ApprovalCountdown({
	timeoutAt,
	timeoutMs,
}: {
	timeoutAt: number;
	timeoutMs?: number;
}) {
	const expired = useApprovalExpired(timeoutAt);
	const [shrink, setShrink] = useState(false);
	useEffect(() => {
		const raf = requestAnimationFrame(() => setShrink(true));
		return () => cancelAnimationFrame(raf);
	}, []);

	if (expired) {
		return (
			<p
				className="text-destructive text-xs"
				data-slot="approval-countdown-expired"
			>
				已超时，按拒绝处理
			</p>
		);
	}
	const remainingMs = Math.max(timeoutAt - Date.now(), 0);
	const initialWidthPercent = countdownWidthPercent(
		remainingMs,
		timeoutMs ?? DEFAULT_APPROVAL_WINDOW_MS
	);
	return (
		<div
			className="h-1 overflow-hidden rounded-full bg-muted"
			data-slot="approval-countdown"
		>
			<div
				className="h-full bg-primary"
				data-slot="approval-countdown-fill"
				style={{
					transitionDuration: `${remainingMs}ms`,
					transitionProperty: "width",
					transitionTimingFunction: "linear",
					width: shrink ? "0%" : `${initialWidthPercent}%`,
				}}
			/>
		</div>
	);
}

/**
 * Approval request card: title + optional detail + one button per option.
 * The first option is the "allow"-style default action, the rest render as
 * outline buttons. Once `answeredOptionId` is set — this session's own click
 * (optimistically, before the round trip settles) or a replayed event for an
 * already-answered `requestId` — THIS card's buttons disable and the chosen
 * one shows a check. Disabling is per-card, deliberately NOT gated on the
 * connection's global "sending" flag, which would grey out every open card
 * whenever any one of them was answered.
 *
 * R3-T2: below the header, an optional muted `summary` line (codex fileChange
 * only, for now) and an optional countdown bar/expiry notice driven by
 * `timeoutAt` — both additive fields, absent for other adapters/requests.
 */
export function ApprovalLine({
	answeredOptionId,
	event,
	onAnswer,
}: ApprovalLineProps) {
	const disabled = answeredOptionId !== undefined;
	return (
		<div className="overflow-hidden rounded-md border bg-muted/40 font-sans">
			<div className="flex flex-col gap-1.5 px-3 py-2">
				<p className="font-medium text-sm">{event.title}</p>
				{event.detail && (
					<p className="text-muted-foreground text-xs">{event.detail}</p>
				)}
				{event.summary && (
					<p
						className="text-muted-foreground text-xs"
						data-slot="approval-summary"
					>
						{event.summary}
					</p>
				)}
				{event.timeoutAt !== undefined && !disabled && (
					<ApprovalCountdown
						timeoutAt={event.timeoutAt}
						timeoutMs={event.timeoutMs}
					/>
				)}
			</div>
			<div className="flex flex-wrap gap-2 border-t px-3 py-2">
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
			</div>
		</div>
	);
}
