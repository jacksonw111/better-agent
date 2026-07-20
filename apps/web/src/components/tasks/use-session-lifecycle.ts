import {
	type QueryClient,
	useMutation,
	useQueryClient,
} from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { TaskDetail, TaskRun } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";

// P3: the session chat's lifecycle transitions, split out of
// task-conversation.tsx (300-line file cap). One hook owns the moves:
//  - entering a SETTLED session auto-resumes it (tasks.resume appends a new
//    run continuing the same runtime conversation) — this is also what fixes
//    "an ended session can't be reopened";
//  - switching to a sibling session just NAVIGATES. Sessions are long-lived
//    work units: leaving the page (or hopping to a sibling) must never end
//    one, or the user loses the agent that was still working for them. The
//    ONLY way a session ends is the header's explicit Stop (below) — which is
//    also what makes the global active-session indicator meaningful.
//  - the header's Stop ends the live run's session in place.

/** A run in one of these states is settled — entering the session appends a
 * fresh run via tasks.resume (the server rejects resuming anything live). */
export const TERMINAL_RUN_STATUSES: ReadonlySet<TaskRun["status"]> = new Set([
	"completed",
	"failed",
	"stopped",
]);

/** Launch-pipeline states a freshly resumed run passes through before the
 * agent is actually back — the overlay stays up until it leaves them. */
const PRE_LIVE_RUN_STATUSES: ReadonlySet<TaskRun["status"]> = new Set([
	"created",
	"launching",
	"preparing_workspace",
	"starting_runtime",
]);

export interface SessionLifecycle {
	/** The failed resume call's message, or null when none failed. */
	resumeError: string | null;
	resumePending: boolean;
	/** True from the resume call until the appended run reports a post-launch
	 * status — drives the "正在恢复会话…" overlay. */
	resuming: boolean;
	retryResume: () => void;
	/** Switches to a sibling session — a pure navigation. The session being
	 * left keeps running in the background. */
	selectSession: (taskId: string) => void;
	stop: () => void;
	stopPending: boolean;
}

function useResumeMutation(
	queryClient: QueryClient,
	setResumedRunId: (runId: string) => void,
	setResumeError: (message: string | null) => void
) {
	return useMutation(
		orpc.tasks.resume.mutationOptions({
			onSuccess: ({ runId }: { runId: string }) => {
				setResumedRunId(runId);
				setResumeError(null);
				queryClient.invalidateQueries({ queryKey: orpc.tasks.get.key() });
			},
			onError: (error: Error) => setResumeError(error.message),
		})
	);
}

/** Auto-resume ONCE per session entry (the route keys the page by taskId): a
 * settled latest run means "reopen this conversation". A live run needs no
 * resume; a failed RESUMED run surfaces its banner instead of looping. */
function useAutoResume(
	taskId: string,
	detail: TaskDetail | undefined,
	resumeMutate: (input: { taskId: string }) => void
): void {
	const attemptedRef = useRef(false);
	useEffect(() => {
		if (attemptedRef.current || !detail) {
			return;
		}
		attemptedRef.current = true;
		const latest = detail.runs.at(-1);
		if (latest && TERMINAL_RUN_STATUSES.has(latest.status)) {
			resumeMutate({ taskId });
		}
	}, [detail, taskId, resumeMutate]);
}

/** The overlay window: open from the resume call until the appended run
 * reports a post-launch status (running/waiting — or terminal, when the
 * relaunch itself failed and the banner takes over). */
function stillResuming(
	resumedRunId: string | null,
	resumeError: string | null,
	latestRun: TaskRun | null
): boolean {
	if (resumedRunId === null || resumeError !== null) {
		return false;
	}
	return (
		latestRun === null ||
		latestRun.id !== resumedRunId ||
		PRE_LIVE_RUN_STATUSES.has(latestRun.status)
	);
}

interface MoveDeps {
	endMutate: (
		input: { sessionId: string },
		options: { onSettled: () => void }
	) => void;
	goTo: (taskId: string) => void;
	latestRun: TaskRun | null;
	onInvalidate: () => void;
	taskId: string;
}

/** The navigate / stop moves, built from the hook's live deps — split out
 * purely for the max-lines-per-function gate. Switching sessions deliberately
 * does NOT touch the current run: the session keeps working in the background
 * and stays listed in the global active-session indicator. */
function sessionMoves(deps: MoveDeps) {
	const { endMutate, goTo, latestRun, taskId } = deps;
	const selectSession = (nextTaskId: string) => {
		if (nextTaskId === taskId) {
			return;
		}
		goTo(nextTaskId);
	};
	const stop = () => {
		if (latestRun?.sessionId) {
			endMutate(
				{ sessionId: latestRun.sessionId },
				{ onSettled: deps.onInvalidate }
			);
		}
	};
	return { selectSession, stop };
}

/** Everything the conversation page's session lifecycle needs in one hook. */
export function useSessionLifecycle(
	taskId: string,
	detail: TaskDetail | undefined
): SessionLifecycle {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const [resumedRunId, setResumedRunId] = useState<string | null>(null);
	const [resumeError, setResumeError] = useState<string | null>(null);
	const latestRun = detail?.runs.at(-1) ?? null;

	const resume = useResumeMutation(
		queryClient,
		setResumedRunId,
		setResumeError
	);
	const endSession = useMutation(orpc.bridge.endSession.mutationOptions({}));
	useAutoResume(taskId, detail, resume.mutate);

	const moves = sessionMoves({
		endMutate: endSession.mutate,
		goTo: (nextTaskId) =>
			navigate({ params: { taskId: nextTaskId }, to: "/tasks/$taskId" }),
		latestRun,
		onInvalidate: () =>
			queryClient.invalidateQueries({ queryKey: orpc.tasks.get.key() }),
		taskId,
	});

	return {
		...moves,
		resumeError,
		resumePending: resume.isPending,
		resuming:
			resume.isPending || stillResuming(resumedRunId, resumeError, latestRun),
		retryResume: () => {
			setResumeError(null);
			resume.mutate({ taskId });
		},
		stopPending: endSession.isPending,
	};
}
