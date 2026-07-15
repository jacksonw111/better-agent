import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { ArchiveRestoreIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import type { BridgeSessionRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";
import { relativeTime } from "@/utils/relative-time";
import { useSessionActions } from "./local-agent-session-actions";
import { DeleteSessionDialog } from "./local-agent-session-menu";
import { sessionTitle } from "./local-agent-session-picker";

// P3-T1: the sidebar's archived view — this token's archived sessions
// (fetched once with `archived: true`, no polling: nothing in here is live),
// each offering restore and permanent delete. Swapped in for the main list by
// the sidebar's bottom toggle.

/** One archived session: title + archive time, with restore and (confirmed)
 * hard-delete actions. */
function ArchivedSessionRow({
	onDelete,
	onRestore,
	session,
}: {
	onDelete: () => void;
	onRestore: () => void;
	session: BridgeSessionRow;
}) {
	const [confirmOpen, setConfirmOpen] = useState(false);
	const title = sessionTitle(session);
	return (
		<div className="group flex items-center gap-1 rounded-lg pr-1 transition-colors hover:bg-muted/40">
			<span className="flex min-w-0 flex-1 flex-col px-2 py-1.5">
				<span className="truncate text-sm">{title}</span>
				<span className="truncate text-muted-foreground text-xs">
					{session.archivedAt
						? `Archived ${relativeTime(new Date(session.archivedAt).toISOString())}`
						: "Archived"}
				</span>
			</span>
			<button
				aria-label={`Restore ${title}`}
				className="rounded-md p-2 text-muted-foreground transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 md:p-1.5 md:opacity-0"
				onClick={onRestore}
				type="button"
			>
				<ArchiveRestoreIcon className="size-3.5" />
			</button>
			<button
				aria-label={`Delete ${title}`}
				className="rounded-md p-2 text-muted-foreground transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 md:p-1.5 md:opacity-0"
				onClick={() => setConfirmOpen(true)}
				type="button"
			>
				<Trash2Icon className="size-3.5" />
			</button>
			<DeleteSessionDialog
				onConfirm={onDelete}
				onOpenChange={setConfirmOpen}
				open={confirmOpen}
				title={title}
			/>
		</div>
	);
}

/** This token's archived sessions, newest first. Restoring invalidates the
 * shared listSessions cache, so the row hops straight back to the main list. */
export function ArchivedSessionList({ tokenId }: { tokenId: string }) {
	const query = useQuery(
		orpc.bridge.listSessions.queryOptions({
			input: { archived: true, tokenId },
		})
	);
	const actions = useSessionActions();
	const sessions = query.data?.sessions ?? [];
	if (query.isPending) {
		return <Skeleton className="mx-1 h-8" />;
	}
	if (sessions.length === 0) {
		return (
			<p className="px-3 py-2 text-muted-foreground text-xs">
				No archived sessions.
			</p>
		);
	}
	return (
		<div className="flex flex-col gap-0.5">
			{sessions.map((session) => (
				<ArchivedSessionRow
					key={session.id}
					onDelete={() =>
						actions.deleteSession.mutate({ sessionId: session.id })
					}
					onRestore={() => actions.restore.mutate({ sessionId: session.id })}
					session={session}
				/>
			))}
		</div>
	);
}
