import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, within } from "@testing-library/react";
import type { ComponentType } from "react";
import type {
	SessionListFixture,
	TaskDetailFixture,
} from "./task-conversation-fixtures";

// Shared harness for the Task Conversation tests — mutable store + the
// `@/utils/orpc` / bridge-transport / router mock builders, mirroring
// local-agent-workspace-test-utils.tsx. The fixture factories live in
// task-conversation-fixtures.ts (300-line file cap). Deliberately imports NO
// app modules so the test files' `vi.mock` factories can `await import(...)`
// it without a mock-resolution cycle. Not a `*.test.*` file, so vitest's
// include skips it.

/** One mutable store per test FILE, reset per test via `resetTaskStore`. */
export const taskStore = {
	connectedSessionIds: [] as string[],
	detail: null as TaskDetailFixture | null,
	/** sessionIds passed to bridge.endSession (the stop path). */
	endSessionCalls: [] as string[],
	/** Per-session persisted relay events served by the transport's history. */
	historyBySession: {} as Record<string, { event: unknown; seq: number }[]>,
	/** sessionIds fetched through the transport's history (fix-crash-2: prior
	 * runs must NOT prefetch their transcripts while collapsed). */
	historyCalls: [] as string[],
	/** tasks.list filter inputs, recorded per query mount/refetch. */
	listInputs: [] as unknown[],
	/** taskIds navigated to via useNavigate (the session switch target). */
	navigations: [] as string[],
	/** projects.get's row (Q3: the header's project chip), or null = not found. */
	project: null as { id: string; name: string } | null,
	resumeCalls: [] as string[],
	/** When set, tasks.resume rejects with this message instead. */
	resumeError: null as string | null,
	resumeResult: { runId: "run-next" },
	/** The sibling sessions tasks.list serves to the sidebar. */
	sessions: [] as SessionListFixture[],
};

export function resetTaskStore(): void {
	taskStore.connectedSessionIds.length = 0;
	taskStore.detail = null;
	taskStore.endSessionCalls.length = 0;
	taskStore.historyBySession = {};
	taskStore.historyCalls.length = 0;
	taskStore.listInputs.length = 0;
	taskStore.navigations.length = 0;
	taskStore.project = null;
	taskStore.resumeCalls.length = 0;
	taskStore.resumeError = null;
	taskStore.resumeResult = { runId: "run-next" };
	taskStore.sessions = [];
}

/** The `./bridge-transport`-shaped mock (task-chat re-exports the real one):
 * records connects, serves the store's per-session history. */
export function buildTaskTransportMock() {
	return {
		createBridgeTransport: () => ({
			connectStream: (args: { sessionId: string }) => {
				taskStore.connectedSessionIds.push(args.sessionId);
				return () => {
					// unsubscribe: no-op for this fake
				};
			},
			history: (input: {
				afterSeq?: number;
				limit?: number;
				sessionId: string;
			}) => {
				taskStore.historyCalls.push(input.sessionId);
				const rows = taskStore.historyBySession[input.sessionId] ?? [];
				const afterSeq = input.afterSeq ?? 0;
				const paged = rows.filter((row) => row.seq > afterSeq);
				return Promise.resolve(
					input.limit === undefined ? paged : paged.slice(0, input.limit)
				);
			},
			observe: () => Promise.resolve([]),
			sendInput: () => Promise.resolve(),
		}),
	};
}

/** The `@tanstack/react-router` mock: an anchor-shaped Link (params
 * substituted into the href) and a useNavigate that records the target
 * session id. */
export function buildTaskRouterMock() {
	return {
		Link: ({
			children,
			className,
			params,
			to,
			...rest
		}: {
			children?: React.ReactNode;
			className?: string;
			params?: Record<string, string>;
			to: string;
		}) => (
			<a
				className={className}
				href={Object.entries(params ?? {}).reduce(
					(path, [key, value]) => path.replace(`$${key}`, value),
					to
				)}
				{...rest}
			>
				{children}
			</a>
		),
		useNavigate:
			() => (options: { params?: { taskId?: string }; to: string }) => {
				taskStore.navigations.push(options.params?.taskId ?? options.to);
				return Promise.resolve();
			},
	};
}

/** The tasks.* slice of the orpc mock: get/list read the live store, resume
 * records its calls, honoring the canned error/result. */
function buildTasksMock() {
	return {
		get: {
			key: () => ["tasks", "get"],
			queryOptions: (opts?: { input?: { taskId?: string } }) => ({
				queryKey: ["tasks", "get", opts?.input?.taskId],
				queryFn: () =>
					taskStore.detail
						? Promise.resolve(taskStore.detail)
						: Promise.reject(new Error("Task not found")),
			}),
		},
		list: {
			key: () => ["tasks", "list"],
			queryOptions: (opts?: { input?: unknown }) => ({
				queryKey: ["tasks", "list", opts?.input],
				queryFn: () => {
					taskStore.listInputs.push(opts?.input);
					return Promise.resolve(taskStore.sessions);
				},
			}),
		},
		resume: {
			mutationOptions: (opts: Record<string, unknown>) => ({
				mutationFn: (input: { taskId: string }) => {
					taskStore.resumeCalls.push(input.taskId);
					return taskStore.resumeError
						? Promise.reject(new Error(taskStore.resumeError))
						: Promise.resolve(taskStore.resumeResult);
				},
				...opts,
			}),
		},
	};
}

/** The `@/utils/orpc` mock: tasks.get/list read the live store, tasks.resume
 * and bridge.endSession record their calls (resume honoring the canned
 * error/result). */
export function buildTaskOrpcMock() {
	return {
		orpc: {
			auth: {
				me: {
					key: () => ["auth", "me"],
					queryOptions: () => ({
						queryKey: ["auth", "me"],
						queryFn: () => Promise.resolve({ email: "tester@example.com" }),
					}),
				},
			},
			bridge: {
				endSession: {
					mutationOptions: (opts: Record<string, unknown>) => ({
						mutationFn: (input: { sessionId: string }) => {
							taskStore.endSessionCalls.push(input.sessionId);
							return Promise.resolve({ ok: true });
						},
						...opts,
					}),
				},
			},
			projects: {
				get: {
					key: () => ["projects", "get"],
					queryOptions: (opts?: { input?: { projectId?: string } }) => ({
						queryKey: ["projects", "get", opts?.input?.projectId],
						queryFn: () =>
							taskStore.project
								? Promise.resolve(taskStore.project)
								: Promise.reject(new Error("Project not found")),
					}),
				},
			},
			tasks: buildTasksMock(),
		},
	};
}

export function renderTaskConversation(
	Conversation: ComponentType<{ taskId: string }>,
	taskId = "task-1"
) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const { container } = render(
		<QueryClientProvider client={queryClient}>
			<Conversation taskId={taskId} />
		</QueryClientProvider>
	);
	return { container, queryClient, view: within(container) };
}
