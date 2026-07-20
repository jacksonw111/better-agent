import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/utils/orpc";
import type { RunStatus } from "./task-status-chip";

// The data layer behind the global active-session indicator. Sessions are
// long-lived work units — leaving the page never ends one (see
// use-session-lifecycle.ts) — so the user needs ONE place that answers "what
// is still running for me, and what is waiting on me?". `tasks.listActive`
// answers it across every computer and project at once; this module shapes
// that flat list into the popover's computer → project → session tree.

/** Matches the other live lists (session sidebar, agent session list) so every
 * surface ages at the same rate. */
export const ACTIVE_SESSIONS_POLL_INTERVAL_MS = 10_000;

/** One live session, anywhere. Mirrors the `tasks.listActive` row contract. */
export interface ActiveSessionItem {
	agentKind: string;
	computerId: string;
	computerName: string;
	/** ISO timestamp of the session's last agent/user activity. */
	lastActivityAt: string;
	name: string;
	/** The agent is blocked on the user (a question, an approval). */
	needsAttention: boolean;
	projectId: string | null;
	projectName: string | null;
	runId: string;
	status: RunStatus;
	taskId: string;
}

export interface ActiveProjectGroup {
	/** Stable React key — `projectId` is nullable, so it can't serve as one. */
	key: string;
	projectId: string | null;
	projectName: string | null;
	sessions: ActiveSessionItem[];
}

export interface ActiveComputerGroup {
	computerId: string;
	computerName: string;
	projects: ActiveProjectGroup[];
}

export interface ActiveSessionsSummary {
	attentionCount: number;
	needsAttention: boolean;
	total: number;
}

/** The trigger's badge state: how many are live, and how many want you. */
export function activeSessionsSummary(
	sessions: readonly ActiveSessionItem[]
): ActiveSessionsSummary {
	const attentionCount = sessions.filter(
		(session) => session.needsAttention
	).length;
	return {
		attentionCount,
		needsAttention: attentionCount > 0,
		total: sessions.length,
	};
}

/** Waiting-on-you first, then most recently active first — the order you'd
 * actually work the list in. */
function byAttentionThenRecency(
	a: ActiveSessionItem,
	b: ActiveSessionItem
): number {
	if (a.needsAttention !== b.needsAttention) {
		return a.needsAttention ? -1 : 1;
	}
	return (
		new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime()
	);
}

const NO_PROJECT_KEY = "__no_project__";

function projectGroupKey(session: ActiveSessionItem): string {
	return session.projectId ?? NO_PROJECT_KEY;
}

function upsertProjectGroup(
	group: ActiveComputerGroup,
	session: ActiveSessionItem
): void {
	const key = projectGroupKey(session);
	const existing = group.projects.find((project) => project.key === key);
	if (existing) {
		existing.sessions.push(session);
		return;
	}
	group.projects.push({
		key,
		projectId: session.projectId,
		projectName: session.projectName,
		sessions: [session],
	});
}

/** Computer → project → session, first-seen order for the groups (so the tree
 * doesn't reshuffle under the cursor between polls) and
 * attention-then-recency inside each project. Project-less sessions sort
 * first within their computer, since they belong to the computer directly. */
export function groupActiveSessions(
	sessions: readonly ActiveSessionItem[]
): ActiveComputerGroup[] {
	const groups: ActiveComputerGroup[] = [];
	for (const session of sessions) {
		const group = groups.find(
			(candidate) => candidate.computerId === session.computerId
		);
		if (group) {
			upsertProjectGroup(group, session);
		} else {
			groups.push({
				computerId: session.computerId,
				computerName: session.computerName,
				projects: [],
			});
			upsertProjectGroup(groups.at(-1) as ActiveComputerGroup, session);
		}
	}
	for (const group of groups) {
		group.projects.sort((a, b) => {
			if ((a.projectId === null) !== (b.projectId === null)) {
				return a.projectId === null ? -1 : 1;
			}
			return 0;
		});
		for (const project of group.projects) {
			project.sessions.sort(byAttentionThenRecency);
		}
	}
	return groups;
}

/** Active-session rollup per project id, for the computer detail page's
 * project rows ("2 active" beside a project you left running). Project-less
 * sessions are skipped — they belong to the computer, not a project row. */
export function countActiveByProject(
	sessions: readonly ActiveSessionItem[]
): Record<string, ActiveSessionsSummary> {
	const byProject: Record<string, ActiveSessionsSummary> = {};
	for (const session of sessions) {
		if (session.projectId === null) {
			continue;
		}
		const current = byProject[session.projectId] ?? {
			attentionCount: 0,
			needsAttention: false,
			total: 0,
		};
		const attentionCount =
			current.attentionCount + (session.needsAttention ? 1 : 0);
		byProject[session.projectId] = {
			attentionCount,
			needsAttention: attentionCount > 0,
			total: current.total + 1,
		};
	}
	return byProject;
}

interface ActiveSessionsProcedure {
	key: () => readonly unknown[];
	queryOptions: () => {
		queryFn: () => Promise<{ sessions: ActiveSessionItem[] }>;
		queryKey: readonly unknown[];
	};
}

/** Stands in when the router has no `listActive` yet — an empty list, which
 * renders as the indicator's quiet state. The indicator is mounted in the app
 * SHELL, so a missing procedure must never throw: that would take down every
 * page rather than one badge. */
const MISSING_PROCEDURE: ActiveSessionsProcedure = {
	key: () => ["tasks", "listActive"],
	queryOptions: () => ({
		queryFn: () => Promise.resolve({ sessions: [] }),
		queryKey: ["tasks", "listActive"],
	}),
};

/** `tasks.listActive` is landing server-side in parallel with this UI. Reach
 * it through one narrow structural cast so this module type-checks both
 * before and after the router picks the procedure up — the cast is confined
 * here rather than smeared across the components. */
function activeSessionsProcedure(): ActiveSessionsProcedure {
	const tasks = orpc.tasks as unknown as
		| { listActive?: ActiveSessionsProcedure }
		| undefined;
	return tasks?.listActive ?? MISSING_PROCEDURE;
}

/** Every live session for the current user, polled. `meta.silent` opts out of
 * the global error toast: this query runs on every page every 10s, so a
 * transient failure must not spam toasts — the panel shows the error inline. */
export function useActiveSessions() {
	const query = useQuery({
		...activeSessionsProcedure().queryOptions(),
		meta: { silent: true },
		refetchInterval: ACTIVE_SESSIONS_POLL_INTERVAL_MS,
	});
	return {
		error: query.error,
		isPending: query.isPending,
		sessions: query.data?.sessions,
	};
}
