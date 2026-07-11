import { Badge } from "@better-agent/ui/components/badge";
import type { TextWhen } from "./agent-capabilities";
import { ControlSelect, type PickerOption } from "./terminal-control-select";

// R3-T1 Part A: the busy-input policy hint row shown above the composer
// whenever a turn is in flight AND the agent supports more than the bare
// default ("queue" alone doesn't need a picker — there's nothing to choose).
// Rendering is gated by the caller (terminal-composer.tsx); this component
// itself always renders once mounted.

/** Wire `TextWhen` -> the composer's Chinese label, in the order offered to
 * the dropdown (queue first, as the always-safe default). */
export const BUSY_WHEN_LABELS: Record<TextWhen, string> = {
	queue: "排队",
	steer: "插话",
	interrupt: "打断后发送",
};

/** Narrows a `ControlSelect.onChange`'s raw `string` back to `TextWhen` before
 * it reaches a `TextWhen`-typed callback — type narrowing over an assertion,
 * per the repo's type-safety guidance. `options` is always built from
 * `BUSY_WHEN_LABELS`'s own keys, so this should never actually reject a real
 * selection; it's a defensive guard against a stale/unexpected wire value. */
function isTextWhen(value: string): value is TextWhen {
	return value === "queue" || value === "steer" || value === "interrupt";
}

function busyWhenOptions(busyModes: TextWhen[]): PickerOption[] {
	return busyModes.map((mode) => ({
		label: BUSY_WHEN_LABELS[mode],
		value: mode,
	}));
}

function hasQueuedMessages(queuedCount: number | null | undefined): boolean {
	return typeof queuedCount === "number" && queuedCount > 0;
}

export interface BusyInputHintProps {
	busyModes: TextWhen[];
	onWhenChange: (when: TextWhen) => void;
	/** pi's queued-message count (see bridge-queue-status.ts) — the "已排队 N
	 * 条" chip renders only once this is a positive number; `undefined`/`null`/
	 * `0` all hide it, matching the brief's "skip silently" degrade. */
	queuedCount?: number | null;
	when: TextWhen;
}

/** The compact inline hint row: "agent 正在工作 — 回车将 [排队 ▾]" plus an
 * optional "已排队 N 条" chip. Mounted only while `turnInFlight &&
 * busyModes.length > 1` (see `TerminalComposer`) — with a single busy mode
 * there's nothing to pick, so a plain send is the only option anyway. */
export function BusyInputHint({
	busyModes,
	onWhenChange,
	queuedCount,
	when,
}: BusyInputHintProps) {
	return (
		<div className="mb-1.5 flex items-center gap-1.5 px-1 text-muted-foreground text-xs">
			<span>agent 正在工作 — 回车将</span>
			<ControlSelect
				disabled={false}
				label="发送方式"
				onChange={(value) => {
					if (isTextWhen(value)) {
						onWhenChange(value);
					}
				}}
				options={busyWhenOptions(busyModes)}
				value={when}
			/>
			{hasQueuedMessages(queuedCount) && (
				<Badge variant="outline">已排队 {queuedCount} 条</Badge>
			)}
		</div>
	);
}
