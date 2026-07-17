import { useMemo } from "react";
import {
	type BridgeTransport,
	createBridgeTransport,
} from "@/components/bridge/bridge-transport";
import { Terminal } from "@/components/bridge/terminal";
import type { BridgeSessionRow, TaskRun } from "@/utils/api-types";
import { OpeningMessageRow } from "./opening-message-row";
import { PastRunHistory } from "./past-run-history";
import { runStatusLabel } from "./task-status-chip";

// S3-T2/P3: the session chat — the Opening Message (when the session started
// with one), the previous runs' read-only history (P3 continuity: a resumed
// session is ONE thread across runs), then the current run's live session
// stream, rendered by the SAME terminal the /local workspace uses. Run
// lifecycle (preparing/starting/failed) NEVER appears here as messages —
// status/error live with the header, outside this pane.

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

/** The standalone (no-session-yet) chat: the leading content alone, in the
 * same centered column the terminal feed uses, so the later terminal mount
 * doesn't visually shift it. */
function LeadingOnly({ children }: { children: React.ReactNode }) {
	return (
		<div className="min-h-0 flex-1 overflow-y-auto">
			<div className="mx-auto w-full max-w-3xl px-3 py-4 sm:px-4">
				{children}
			</div>
		</div>
	);
}

/** The feed's `leading` slot, memoized: this component re-renders on every
 * poll of the task query, and a fresh element per render would churn the
 * terminal's scroll observers and memoized subtree for nothing. Null when
 * there's nothing to lead with. */
function useLeading(
	openingMessage: string,
	priorRuns: TaskRun[],
	transport: BridgeTransport,
	userAvatarUrl: string | undefined
) {
	return useMemo(() => {
		// P1: a pure chat session has an EMPTY opening message — render nothing
		// rather than an empty user bubble.
		const opening = openingMessage.trim().length > 0 && (
			<OpeningMessageRow avatarUrl={userAvatarUrl} text={openingMessage} />
		);
		const history = priorRuns.length > 0 && (
			<PastRunHistory
				runs={priorRuns}
				transport={transport}
				userAvatarUrl={userAvatarUrl}
			/>
		);
		if (!(opening || history)) {
			return null;
		}
		return (
			<>
				{opening}
				{history}
			</>
		);
	}, [openingMessage, priorRuns, transport, userAvatarUrl]);
}

/** The chat tab's content for the current run (null when the session somehow
 * has no runs — same rendering as an unbound run: just the leading content). */
export function TaskChat({
	openingMessage,
	priorRuns,
	run,
	userAvatarUrl,
}: {
	openingMessage: string;
	/** The session's earlier runs whose history replays read-only above the
	 * live feed — see priorRunsOf (past-run-history.tsx). */
	priorRuns: TaskRun[];
	run: TaskRun | null;
	userAvatarUrl: string | undefined;
}) {
	const transport = useMemo(() => createBridgeTransport(), []);
	const leading = useLeading(
		openingMessage,
		priorRuns,
		transport,
		userAvatarUrl
	);
	const session = run?.session ?? null;
	// tasks.get returns the stored session row; the terminal's row type also
	// carries listSessions' derived attention hint, which the task page doesn't
	// compute — null means "no signal", the same as an ineligible session.
	const sessionRow: BridgeSessionRow | null = useMemo(
		() => (session ? { ...session, attention: null } : null),
		[session]
	);
	if (!(run && sessionRow)) {
		return (
			<div className="flex min-h-0 flex-1 flex-col" data-testid="task-chat">
				<LeadingOnly>{leading}</LeadingOnly>
			</div>
		);
	}
	return (
		<div className="flex min-h-0 flex-1 flex-col" data-testid="task-chat">
			<Terminal
				composerLock={composerLockFor(run.status)}
				hidePastConversations
				hideStatusButton
				key={sessionRow.id}
				leading={leading}
				session={sessionRow}
				transport={transport}
				userAvatarUrl={userAvatarUrl}
			/>
		</div>
	);
}
