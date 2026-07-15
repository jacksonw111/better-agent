import { cn } from "@better-agent/ui/lib/utils";
import { LoaderCircleIcon, PencilIcon, StarIcon } from "lucide-react";
import { useState } from "react";
import type { BridgeSessionRow } from "@/utils/api-types";
import { relativeTime } from "@/utils/relative-time";
import { LocalAgentSessionMenu } from "./local-agent-session-menu";
import { sessionTitle } from "./local-agent-session-picker";
import {
	deriveSessionSignal,
	type SessionSignal,
} from "./local-agent-workspace-sessions";

// P2-T2: one sidebar session row — signal dot, title + relative time, inline
// rename, and (P3-T1) the star toggle + "⋯" archive/delete menu. Rename and
// star persist via the bridge session-mgmt routes (see the sidebar's
// useSessionActions wiring); the title precedence is name ?? label ?? id.

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

/** The inline rename input — commits on Enter/blur (empty commits clear the
 * custom name back to the CLI label), cancels on Escape. */
function SessionRenameInput({
	initial,
	onCancel,
	onCommit,
}: {
	initial: string;
	onCancel: () => void;
	onCommit: (name: string | null) => void;
}) {
	const [draft, setDraft] = useState(initial);
	const commit = () => onCommit(draft.trim() === "" ? null : draft.trim());
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
					onCancel();
				}
			}}
			value={draft}
		/>
	);
}

/** The row's hover/focus-revealed action cluster: star toggle (stays visible
 * once starred), rename pencil, and the archive/delete "⋯" menu — split out
 * of `SessionRowDisplay` to keep it under the max-lines-per-function gate. */
function SessionRowActions({
	onArchive,
	onDelete,
	onEdit,
	onToggleStar,
	session,
	title,
}: Omit<SessionRowProps, "active" | "onRename" | "onSelect"> & {
	onEdit: () => void;
	title: string;
}) {
	return (
		<span className="flex shrink-0 items-center">
			<button
				aria-label={`Star ${title}`}
				aria-pressed={session.starred}
				className={cn(
					// Touch: always visible with a p-2 target; md+ reverts to the
					// tighter hover-revealed cluster (the ui sidebar's md:opacity-0
					// convention).
					"rounded-md p-2 transition-opacity md:p-1.5",
					session.starred
						? "text-amber-500"
						: "text-muted-foreground hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 md:opacity-0"
				)}
				onClick={onToggleStar}
				type="button"
			>
				<StarIcon
					className={cn("size-3.5", session.starred && "fill-current")}
				/>
			</button>
			<button
				aria-label={`Rename ${title}`}
				className="rounded-md p-2 text-muted-foreground transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 md:p-1.5 md:opacity-0"
				onClick={onEdit}
				type="button"
			>
				<PencilIcon className="size-3.5" />
			</button>
			<LocalAgentSessionMenu
				onArchive={onArchive}
				onDelete={onDelete}
				title={title}
			/>
		</span>
	);
}

/** The row's resting state: signal + title + relative time (the select
 * button) beside the action cluster — split out of `LocalAgentSessionRow` to
 * keep it under the max-lines-per-function gate. */
function SessionRowDisplay({
	active,
	onEdit,
	...props
}: Omit<SessionRowProps, "onRename"> & { onEdit: () => void }) {
	const { onSelect, session } = props;
	const title = sessionTitle(session);
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
					<span className="truncate text-sm">{title}</span>
					<span className="truncate text-muted-foreground text-xs">
						{relativeTime(new Date(session.lastSeenAt).toISOString())}
					</span>
				</span>
			</button>
			<SessionRowActions {...props} onEdit={onEdit} title={title} />
		</div>
	);
}

interface SessionRowProps {
	active: boolean;
	onArchive: () => void;
	onDelete: () => void;
	onRename: (name: string | null) => void;
	onSelect: () => void;
	onToggleStar: () => void;
	session: BridgeSessionRow;
}

/** One session in the workspace sidebar: the whole row selects the session
 * (updating `?session=`), the pencil opens the inline rename (persisted via
 * `onRename`), the star pins, and the "⋯" menu archives/deletes. */
export function LocalAgentSessionRow({ onRename, ...props }: SessionRowProps) {
	const [editing, setEditing] = useState(false);
	if (editing) {
		return (
			<div className="px-1 py-0.5">
				<SessionRenameInput
					initial={props.session.name ?? props.session.label ?? ""}
					onCancel={() => setEditing(false)}
					onCommit={(name) => {
						setEditing(false);
						onRename(name);
					}}
				/>
			</div>
		);
	}
	return <SessionRowDisplay {...props} onEdit={() => setEditing(true)} />;
}
