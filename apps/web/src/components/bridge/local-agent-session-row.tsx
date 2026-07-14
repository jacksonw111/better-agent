import { cn } from "@better-agent/ui/lib/utils";
import { LoaderCircleIcon, PencilIcon } from "lucide-react";
import { useState } from "react";
import type { BridgeSessionRow } from "@/utils/api-types";
import { relativeTime } from "@/utils/relative-time";
import {
	deriveSessionSignal,
	type SessionSignal,
} from "./local-agent-workspace-sessions";

// P2-T2: one sidebar session row — signal dot, label + relative time, and the
// inline-rename shell (pencil → input; persistence lands in P3).

const SIGNAL_LABEL: Record<SessionSignal, string> = {
	approval: "Waiting for approval",
	processing: "Working",
	live: "Live",
	idle: "Idle",
	ended: "Ended",
};

const SIGNAL_DOT_CLASS: Record<Exclude<SessionSignal, "processing">, string> = {
	approval: "animate-pulse bg-amber-500",
	live: "bg-emerald-500",
	idle: "bg-muted-foreground/40",
	ended: "bg-muted-foreground/20",
};

/** The row's single status glyph: spinner while the agent is working, a
 * colored dot otherwise (amber pulse = waiting on an approval, green = live,
 * muted = idle, faint = ended). The label rides along visually hidden so
 * screen readers (and tests) get the same signal as sighted users. */
function SessionSignalDot({ session }: { session: BridgeSessionRow }) {
	const signal = deriveSessionSignal(session);
	const label = SIGNAL_LABEL[signal];
	if (signal === "processing") {
		return (
			<span className="shrink-0" title={label}>
				<LoaderCircleIcon
					aria-hidden
					className="size-3 animate-spin text-muted-foreground"
				/>
				<span className="sr-only">{label}</span>
			</span>
		);
	}
	// Looked up outside the className expression so the repo's tailwind check
	// doesn't misread the indexer as an arbitrary-value class.
	const dotClass = SIGNAL_DOT_CLASS[signal];
	return (
		<span
			className="flex size-3 shrink-0 items-center justify-center"
			title={label}
		>
			<span aria-hidden className={cn("size-2 rounded-full", dotClass)} />
			<span className="sr-only">{label}</span>
		</span>
	);
}

/** The inline rename input — commits on Enter/blur, cancels on Escape. An
 * empty draft cancels rather than committing a blank label. */
function SessionRenameInput({
	initial,
	onDone,
}: {
	initial: string;
	onDone: (label: string | null) => void;
}) {
	const [draft, setDraft] = useState(initial);
	const commit = () => onDone(draft.trim() === "" ? null : draft.trim());
	return (
		<input
			aria-label="Session name"
			// The input replaces the row the user just clicked — focus must follow.
			autoFocus
			className="w-full min-w-0 rounded-md bg-background px-2 py-1 text-sm outline-none ring-1 ring-ring/40"
			onBlur={commit}
			onChange={(event) => setDraft(event.target.value)}
			onKeyDown={(event) => {
				if (event.key === "Enter") {
					commit();
				}
				if (event.key === "Escape") {
					onDone(null);
				}
			}}
			value={draft}
		/>
	);
}

/** The row's resting state: signal + label + relative time (the select
 * button) beside the hover/focus-revealed rename pencil — split out of
 * `LocalAgentSessionRow` to keep it under the max-lines-per-function gate. */
function SessionRowDisplay({
	active,
	displayLabel,
	onEdit,
	onSelect,
	session,
}: {
	active: boolean;
	displayLabel: string;
	onEdit: () => void;
	onSelect: () => void;
	session: BridgeSessionRow;
}) {
	return (
		<div
			className={cn(
				"group flex items-center gap-1 rounded-lg pr-1 transition-colors",
				active ? "bg-muted/70" : "hover:bg-muted/40"
			)}
		>
			<button
				aria-current={active ? "true" : undefined}
				className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left"
				onClick={onSelect}
				type="button"
			>
				<SessionSignalDot session={session} />
				<span className="flex min-w-0 flex-col">
					<span className="truncate text-sm">{displayLabel}</span>
					<span className="truncate text-muted-foreground text-xs">
						{relativeTime(new Date(session.lastSeenAt).toISOString())}
					</span>
				</span>
			</button>
			<button
				aria-label={`Rename ${displayLabel}`}
				className="rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
				onClick={onEdit}
				type="button"
			>
				<PencilIcon className="size-3.5" />
			</button>
		</div>
	);
}

/** One session in the workspace sidebar: the whole row selects the session
 * (updating `?session=`), the pencil (hover/focus-revealed) opens the inline
 * rename shell. `displayLabel` is the client-side (possibly renamed) label —
 * the rename itself is owned by the sidebar. */
export function LocalAgentSessionRow({
	active,
	displayLabel,
	onRename,
	onSelect,
	session,
}: {
	active: boolean;
	displayLabel: string;
	onRename: (label: string) => void;
	onSelect: () => void;
	session: BridgeSessionRow;
}) {
	const [editing, setEditing] = useState(false);
	if (editing) {
		return (
			<div className="px-1 py-0.5">
				<SessionRenameInput
					initial={displayLabel}
					onDone={(label) => {
						setEditing(false);
						if (label !== null) {
							onRename(label);
						}
					}}
				/>
			</div>
		);
	}
	return (
		<SessionRowDisplay
			active={active}
			displayLabel={displayLabel}
			onEdit={() => setEditing(true)}
			onSelect={onSelect}
			session={session}
		/>
	);
}
