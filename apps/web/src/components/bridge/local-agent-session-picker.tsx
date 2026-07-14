import { Button } from "@better-agent/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@better-agent/ui/components/dropdown-menu";
import { ChevronDownIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { BridgeSessionRow } from "@/utils/api-types";
import { deriveLocalAgentStatus } from "./local-agent-status";
import { LocalAgentStatusChip } from "./local-agent-status-chip";

const SHORT_ID_LENGTH = 8;

const sessionTimeFormatter = new Intl.DateTimeFormat(undefined, {
	dateStyle: "short",
	timeStyle: "short",
});

function sessionShortId(session: BridgeSessionRow): string {
	return session.id.slice(0, SHORT_ID_LENGTH);
}

/** The human title for a session row: the user's web rename (`name`) wins,
 * then the CLI-reported launch `label`, then a short slice of the id so an
 * unlabeled session is still distinguishable. Shared with the workspace
 * sidebar (P2-T2) so the two never disagree. */
export function sessionTitle(session: BridgeSessionRow): string {
	return session.name ?? session.label ?? sessionShortId(session);
}

/** This token's sessions, newest first — the order the picker lists them and
 * the source of its default (most-recent) selection. */
export function sortSessionsByRecency(
	sessions: BridgeSessionRow[]
): BridgeSessionRow[] {
	return [...sessions].sort(
		(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
	);
}

/** Tracks which of `sessions` (newest-first) is shown. Defaults to — and keeps
 * following — the most recent session until the user explicitly picks one, so a
 * relaunched CLI still auto-advances the terminal while past sessions stay
 * selectable. A selection that vanishes (its session dropped) falls back to the
 * latest. */
export function useSessionSelection(sessions: BridgeSessionRow[]) {
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const userPicked = useRef(false);
	const latestId = sessions[0]?.id ?? null;

	useEffect(() => {
		if (!userPicked.current) {
			setSelectedId(latestId);
		}
	}, [latestId]);

	const activeId = sessions.some((session) => session.id === selectedId)
		? selectedId
		: latestId;
	const activeSession =
		sessions.find((session) => session.id === activeId) ?? null;
	const select = (id: string) => {
		userPicked.current = true;
		setSelectedId(id);
	};

	return { activeSession, select };
}

function SessionMeta({
	session,
	now,
}: {
	session: BridgeSessionRow;
	now: Date;
}) {
	return (
		<span className="flex items-center gap-2 text-muted-foreground text-xs">
			<span className="tabular-nums">{sessionShortId(session)}</span>
			<span aria-hidden>·</span>
			<span className="tabular-nums">
				{sessionTimeFormatter.format(new Date(session.createdAt))}
			</span>
			<LocalAgentStatusChip status={deriveLocalAgentStatus(session, now)} />
		</span>
	);
}

function PickerTrigger({
	active,
	onlyOne,
	now,
}: {
	active: BridgeSessionRow;
	onlyOne: boolean;
	now: Date;
}) {
	return (
		<DropdownMenuTrigger
			disabled={onlyOne}
			render={
				<Button
					className="h-auto justify-between gap-2 py-1.5"
					size="sm"
					variant="outline"
				/>
			}
		>
			<span className="flex min-w-0 items-center gap-2">
				<span className="truncate font-medium">{sessionTitle(active)}</span>
				<LocalAgentStatusChip status={deriveLocalAgentStatus(active, now)} />
			</span>
			{onlyOne ? null : (
				<ChevronDownIcon aria-hidden className="size-4 shrink-0" />
			)}
		</DropdownMenuTrigger>
	);
}

/** Dropdown for switching which of a token's sessions the terminal shows. The
 * trigger surfaces the active session; the menu lists every session newest
 * first with its short id, start time and live/idle/ended status. Disabled when
 * there is only one session to show. */
export function LocalAgentSessionPicker({
	sessions,
	activeId,
	onSelect,
	now = new Date(),
}: {
	sessions: BridgeSessionRow[];
	activeId: string | null;
	onSelect: (sessionId: string) => void;
	now?: Date;
}) {
	const active = sessions.find((session) => session.id === activeId) ?? null;
	if (!active) {
		return null;
	}
	return (
		<DropdownMenu>
			<PickerTrigger active={active} now={now} onlyOne={sessions.length <= 1} />
			<DropdownMenuContent align="start" className="min-w-72">
				{sessions.map((session) => (
					<DropdownMenuItem
						className="flex flex-col items-start gap-1"
						key={session.id}
						onClick={() => onSelect(session.id)}
					>
						<span className="font-medium">{sessionTitle(session)}</span>
						<SessionMeta now={now} session={session} />
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
