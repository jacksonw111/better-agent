import { Button } from "@better-agent/ui/components/button";
import {
	Popover,
	PopoverContent,
	PopoverTitle,
	PopoverTrigger,
} from "@better-agent/ui/components/popover";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@better-agent/ui/components/tooltip";
import { useNavigate } from "@tanstack/react-router";
import { SquareIcon } from "lucide-react";
import { AgentKindIcon } from "@/components/bridge/local-agent-kind-icon";
import { AGENT_LABELS } from "@/components/computers/agent-labels";
import { relativeTime } from "@/utils/relative-time";
import { ActivityDot } from "./activity-state-badge";

// P25-B: one live-session row + its End control, split out of the list so both
// files stay under the 300-line cap. The row IS the reattach: its whole left
// region navigates to /terminal/$computerId?session=<id> (the CLI replays that
// session's scrollback). End sits outside that click target and is confirmed —
// a detach never ends a session, only this does.

type AgentKind = keyof typeof AGENT_LABELS;

export interface PtySessionRow {
	activityState: string | null;
	agentKind: AgentKind;
	lastActivityAt: string | Date;
	projectId: string | null;
	sessionId: string;
	status: string;
	title: string;
}

function toIso(value: string | Date): string {
	return value instanceof Date ? value.toISOString() : value;
}

/** The explicit stop, gated behind a confirm so it can't be a stray click. */
function EndSessionButton({
	onConfirm,
	pending,
}: {
	onConfirm: () => void;
	pending: boolean;
}) {
	return (
		<Popover>
			<Tooltip>
				<TooltipTrigger
					render={
						<PopoverTrigger
							render={
								<Button
									aria-label="End session"
									disabled={pending}
									size="icon-xs"
									variant="ghost"
								/>
							}
						/>
					}
				>
					<SquareIcon className="size-3.5" />
				</TooltipTrigger>
				<TooltipContent>End session</TooltipContent>
			</Tooltip>
			<PopoverContent>
				<PopoverTitle className="text-sm">
					End this session? Its terminal and any running agent stop for good.
				</PopoverTitle>
				<div className="mt-2 flex justify-end gap-2">
					<Button size="xs" variant="outline">
						Cancel
					</Button>
					<Button onClick={onConfirm} size="xs" variant="destructive">
						End
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}

/** One live session — the whole left region reattaches in a click; End sits
 * outside that click target so it can't fire a navigation. No borders: tint +
 * radius, matching the agent/session rows elsewhere. */
export function SessionRow({
	computerId,
	ending,
	onEnd,
	session,
}: {
	computerId: string;
	ending: boolean;
	onEnd: () => void;
	session: PtySessionRow;
}) {
	const navigate = useNavigate();
	return (
		<div className="flex items-center gap-2 rounded-xl bg-muted/40 pr-2 transition-colors hover:bg-muted/70">
			<button
				className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left"
				onClick={() =>
					navigate({
						params: { computerId },
						search: { session: session.sessionId },
						to: "/terminal/$computerId",
					})
				}
				type="button"
			>
				<AgentKindIcon
					className="size-5 shrink-0 text-muted-foreground"
					kind={session.agentKind}
				/>
				<span className="flex min-w-0 flex-1 flex-col">
					<span className="flex min-w-0 items-center gap-2">
						<ActivityDot state={session.activityState} />
						<span className="truncate font-medium text-sm">
							{session.title}
						</span>
					</span>
					<span className="truncate text-muted-foreground text-xs">
						{AGENT_LABELS[session.agentKind]} ·{" "}
						{relativeTime(toIso(session.lastActivityAt))}
					</span>
				</span>
			</button>
			<EndSessionButton onConfirm={onEnd} pending={ending} />
		</div>
	);
}
