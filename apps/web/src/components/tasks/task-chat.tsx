import { useMemo } from "react";
import { createBridgeTransport } from "@/components/bridge/bridge-transport";
import { Terminal } from "@/components/bridge/terminal";
import type { BridgeSessionRow, TaskRun } from "@/utils/api-types";
import { OpeningMessageRow } from "./opening-message-row";
import { runStatusLabel } from "./task-status-chip";

// S3-T2: the Task Conversation's chat tab — the Opening Message followed by
// the current run's session stream, rendered by the SAME terminal the /local
// workspace uses (master spec §11: reuse, not a parallel chat). Run lifecycle
// (preparing/starting/failed) NEVER appears here as messages: while the run
// has no bound session the chat is just the Opening Message, and status/error
// live with the header, outside this pane.

/** Run statuses whose session accepts user input (§11.2) — everything else
 * locks the composer with an explanation instead of failing sends quietly. */
const SENDABLE_STATUSES: ReadonlySet<string> = new Set([
	"running",
	"waiting_for_user",
]);

/** The composer-lock explanation for a non-sendable run status, or undefined
 * to leave the composer live. Exported for the conversation tests. */
export function composerLockFor(status: TaskRun["status"]): string | undefined {
	const label = runStatusLabel(status).toLowerCase();
	return SENDABLE_STATUSES.has(status)
		? undefined
		: `This run is ${label} — you can send messages while the agent is running or waiting for you.`;
}

/** The standalone (no-session-yet) chat: the Opening Message alone, in the
 * same centered column the terminal feed uses, so the later terminal mount
 * doesn't visually shift it. */
function OpeningOnly({ children }: { children: React.ReactNode }) {
	return (
		<div className="min-h-0 flex-1 overflow-y-auto">
			<div className="mx-auto w-full max-w-3xl px-3 py-4 sm:px-4">
				{children}
			</div>
		</div>
	);
}

/** The chat tab's content for the current run (null when the task somehow has
 * no runs — same rendering as an unbound run: just the Opening Message). */
export function TaskChat({
	openingMessage,
	run,
	userAvatarUrl,
}: {
	openingMessage: string;
	run: TaskRun | null;
	userAvatarUrl: string | undefined;
}) {
	const transport = useMemo(() => createBridgeTransport(), []);
	const opening = (
		<OpeningMessageRow avatarUrl={userAvatarUrl} text={openingMessage} />
	);
	const session = run?.session ?? null;
	if (!(run && session)) {
		return (
			<div className="flex min-h-0 flex-1 flex-col" data-testid="task-chat">
				<OpeningOnly>{opening}</OpeningOnly>
			</div>
		);
	}
	// tasks.get returns the stored session row; the terminal's row type also
	// carries listSessions' derived attention hint, which the task page doesn't
	// compute — null means "no signal", the same as an ineligible session.
	const sessionRow: BridgeSessionRow = { ...session, attention: null };
	return (
		<div className="flex min-h-0 flex-1 flex-col" data-testid="task-chat">
			<Terminal
				composerLock={composerLockFor(run.status)}
				key={sessionRow.id}
				leading={opening}
				session={sessionRow}
				transport={transport}
				userAvatarUrl={userAvatarUrl}
			/>
		</div>
	);
}
