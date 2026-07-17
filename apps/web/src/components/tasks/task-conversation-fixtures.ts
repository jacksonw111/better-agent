// Fixture shapes + factories for the Task Conversation tests, split out of
// task-conversation-test-utils.tsx (300-line file cap). Deliberately imports
// NO app modules — see that file's header. Not a `*.test.*` file, so vitest's
// include skips it.

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

/** One tasks.list row — the sibling-session sidebar's shape. */
export interface SessionListFixture {
	agentKind: string;
	computerId: string;
	createdAt: Date;
	id: string;
	latestRun: {
		createdAt: Date;
		errorMessage: string | null;
		hasAgentSessionId: boolean;
		id: string;
		status: string;
	} | null;
	name: string;
	status: string;
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

export function makeSessionListItem(
	overrides: Partial<SessionListFixture>
): SessionListFixture {
	const now = new Date();
	return {
		agentKind: "claude-code",
		computerId: "computer-1",
		createdAt: now,
		id: "task-1",
		latestRun: {
			createdAt: now,
			errorMessage: null,
			hasAgentSessionId: false,
			id: "run-1",
			status: "running",
		},
		name: "Fix login redirect",
		status: "active",
		...overrides,
	};
}
