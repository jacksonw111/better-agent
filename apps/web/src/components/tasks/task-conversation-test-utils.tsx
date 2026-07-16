import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, within } from "@testing-library/react";
import type { ComponentType } from "react";

// Shared harness for the Task Conversation tests — mutable store + the
// `@/utils/orpc` / bridge-transport mock builders, mirroring
// local-agent-workspace-test-utils.tsx. Deliberately imports NO app modules
// so the test files' `vi.mock` factories can `await import(...)` it without a
// mock-resolution cycle. Not a `*.test.*` file, so vitest's include skips it.

export interface TaskRunFixture {
	agentKind: string;
	branch: string | null;
	createdAt: Date;
	errorMessage: string | null;
	id: string;
	session: TaskSessionFixture | null;
	sessionId: string | null;
	status: string;
	updatedAt: Date;
	workspaceKind: string;
	workspacePath: string | null;
}

export interface TaskSessionFixture {
	agentKind: string;
	agentSessionId: string | null;
	archivedAt: Date | null;
	createdAt: Date;
	id: string;
	label: string | null;
	lastSeenAt: Date;
	name: string | null;
	runId: string | null;
	starred: boolean;
	status: string;
	tokenId: string;
	userId: string;
	vncEndpoint: string | null;
}

export interface TaskDetailFixture {
	computerName: string | null;
	runs: TaskRunFixture[];
	task: {
		agentKind: string;
		computerId: string;
		createdAt: Date;
		description: string;
		id: string;
		name: string;
		openingMessage: string;
		repositoryFullName: string | null;
		repositoryUrl: string | null;
		status: string;
		updatedAt: Date;
		userId: string;
	};
}

/** One mutable store per test FILE, reset per test via `resetTaskStore`. */
export const taskStore = {
	connectedSessionIds: [] as string[],
	detail: null as TaskDetailFixture | null,
	/** Per-session persisted relay events served by the transport's history. */
	historyBySession: {} as Record<string, { event: unknown; seq: number }[]>,
	retryCalls: [] as string[],
	retryResult: { runId: "run-next" },
};

export function resetTaskStore(): void {
	taskStore.connectedSessionIds.length = 0;
	taskStore.detail = null;
	taskStore.historyBySession = {};
	taskStore.retryCalls.length = 0;
	taskStore.retryResult = { runId: "run-next" };
}

export const OPENING_MESSAGE = [
	"Fix the login redirect bug with /tdd and keep the tests green.",
	"",
	"## Execution context",
	"- Computer: Studio Mac",
	"- Agent Runtime: Claude Code",
	"- Workspace: managed task directory",
].join("\n");

export function makeTaskSession(
	overrides: Partial<TaskSessionFixture>
): TaskSessionFixture {
	const now = new Date();
	return {
		agentKind: "claude-code",
		agentSessionId: null,
		archivedAt: null,
		createdAt: now,
		id: "session-1",
		label: "task:abc",
		lastSeenAt: now,
		name: null,
		runId: "run-1",
		starred: false,
		status: "active",
		tokenId: "token-run-1",
		userId: "user-1",
		vncEndpoint: null,
		...overrides,
	};
}

export function makeTaskRun(
	overrides: Partial<TaskRunFixture>
): TaskRunFixture {
	const now = new Date();
	return {
		agentKind: "claude-code",
		branch: null,
		createdAt: now,
		errorMessage: null,
		id: "run-1",
		session: null,
		sessionId: null,
		status: "created",
		updatedAt: now,
		workspaceKind: "standalone",
		workspacePath: null,
		...overrides,
	};
}

export function makeTaskDetail(
	overrides: Partial<TaskDetailFixture>
): TaskDetailFixture {
	const now = new Date();
	return {
		computerName: "Studio Mac",
		runs: [makeTaskRun({})],
		task: {
			agentKind: "claude-code",
			computerId: "computer-1",
			createdAt: now,
			description: "Fix the login redirect bug with /tdd",
			id: "task-1",
			name: "Fix login redirect",
			openingMessage: OPENING_MESSAGE,
			repositoryFullName: null,
			repositoryUrl: null,
			status: "active",
			updatedAt: now,
			userId: "user-1",
		},
		...overrides,
	};
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
			history: (input: { sessionId: string }) =>
				Promise.resolve(taskStore.historyBySession[input.sessionId] ?? []),
			observe: () => Promise.resolve([]),
			sendInput: () => Promise.resolve(),
		}),
	};
}

/** The `@/utils/orpc` mock: tasks.get reads the live store (rejects when the
 * fixture is null), tasks.retry records and resolves the canned run id. */
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
			tasks: {
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
				retry: {
					mutationOptions: (opts: Record<string, unknown>) => ({
						mutationFn: (input: { taskId: string }) => {
							taskStore.retryCalls.push(input.taskId);
							return Promise.resolve(taskStore.retryResult);
						},
						...opts,
					}),
				},
			},
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
