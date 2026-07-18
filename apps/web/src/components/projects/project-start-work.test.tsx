// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { makeComputer } from "@/components/tasks/wizard-test-fixtures";
import { makeProject, readyProject } from "./project-fixtures";
import { ProjectStartWork } from "./project-start-work";

// Q3: the project detail's Start work block — pick one of the computer's
// agent runtimes, then a session: "New session" (the DEFAULT) creates a
// project session (tasks.create with projectId, empty description) and lands
// in the chat; picking an existing project session navigates straight there.

const NEW_SESSION_PATTERN = /New session/;
const SESSION_ONE_PATTERN = /Session one/;
const OTHER_PROJECT_PATTERN = /Other project/;
const NO_PROJECT_PATTERN = /No project/;
const CODEX_PATTERN = /Codex/;

const store = vi.hoisted(() => ({
	createInputs: [] as Record<string, unknown>[],
	navigations: [] as string[],
	sessions: [] as unknown[],
}));

vi.mock("sonner", () => ({ toast: { error: () => undefined } }));

vi.mock("@tanstack/react-router", () => ({
	useNavigate:
		() => (options: { params?: { taskId?: string }; to: string }) => {
			store.navigations.push(options.params?.taskId ?? options.to);
			return Promise.resolve();
		},
}));

vi.mock("@/utils/orpc", () => ({
	orpc: {
		tasks: {
			create: {
				mutationOptions: (opts: Record<string, unknown>) => ({
					mutationFn: (input: Record<string, unknown>) => {
						store.createInputs.push(input);
						return Promise.resolve({ runId: "run-1", taskId: "task-new" });
					},
					...opts,
				}),
			},
			list: {
				key: () => ["tasks", "list"],
				queryOptions: (opts?: { input?: unknown }) => ({
					queryKey: ["tasks", "list", opts?.input],
					queryFn: () => Promise.resolve(store.sessions),
				}),
			},
		},
	},
}));

function sessionRow(overrides: Record<string, unknown>) {
	return {
		agentKind: "claude-code",
		computerId: "computer-1",
		createdAt: new Date(),
		id: "task-1",
		latestRun: null,
		name: "Session one",
		projectId: "project-1",
		status: "active",
		...overrides,
	};
}

function renderStartWork(
	overrides: { online?: boolean; project?: typeof readyProject } = {}
) {
	const queryClient = new QueryClient({
		defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
	});
	const { container } = render(
		<QueryClientProvider client={queryClient}>
			<ProjectStartWork
				computer={makeComputer()}
				online={overrides.online ?? true}
				project={overrides.project ?? readyProject}
			/>
		</QueryClientProvider>
	);
	return { view: within(container) };
}

afterEach(() => {
	store.createInputs.length = 0;
	store.navigations.length = 0;
	store.sessions = [];
	cleanup();
});

it("defaults to New session and starts a project session in the chat", async () => {
	const { view } = renderStartWork();
	const newSession = (await waitFor(() =>
		view.getByRole("radio", { name: NEW_SESSION_PATTERN })
	)) as HTMLInputElement;
	expect(newSession.checked).toBe(true);

	fireEvent.click(view.getByRole("button", { name: "Start" }));

	await waitFor(() => {
		expect(store.createInputs).toEqual([
			{
				agentKind: "claude-code",
				computerId: "computer-1",
				description: "",
				projectId: "project-1",
			},
		]);
	});
	await waitFor(() => {
		expect(store.navigations).toEqual(["task-new"]);
	});
});

it("lists only THIS project's sessions and opens a picked one directly", async () => {
	store.sessions = [
		sessionRow({ id: "task-1", name: "Session one" }),
		sessionRow({ id: "task-2", name: "Other project", projectId: "project-9" }),
		sessionRow({ id: "task-3", name: "No project", projectId: null }),
	];
	const { view } = renderStartWork();

	await waitFor(() => {
		expect(
			view.getByRole("radio", { name: SESSION_ONE_PATTERN })
		).toBeDefined();
	});
	expect(view.queryByRole("radio", { name: OTHER_PROJECT_PATTERN })).toBeNull();
	expect(view.queryByRole("radio", { name: NO_PROJECT_PATTERN })).toBeNull();

	fireEvent.click(view.getByRole("radio", { name: SESSION_ONE_PATTERN }));
	fireEvent.click(view.getByRole("button", { name: "Start" }));

	await waitFor(() => {
		expect(store.navigations).toEqual(["task-1"]);
	});
	expect(store.createInputs).toEqual([]);
});

it("offers the computer's agent runtimes and starts with the picked one", async () => {
	const { view } = renderStartWork();
	fireEvent.click(
		await waitFor(() => view.getByRole("radio", { name: CODEX_PATTERN }))
	);

	fireEvent.click(view.getByRole("button", { name: "Start" }));

	await waitFor(() => {
		expect(store.createInputs[0]?.agentKind).toBe("codex");
	});
});

it("keeps Start disabled until the project is ready and the computer online", async () => {
	const notReady = renderStartWork({ project: makeProject() });
	expect(
		(
			await waitFor(() => notReady.view.getByRole("button", { name: "Start" }))
		).hasAttribute("disabled")
	).toBe(true);
	cleanup();

	const offline = renderStartWork({ online: false });
	expect(
		(
			await waitFor(() => offline.view.getByRole("button", { name: "Start" }))
		).hasAttribute("disabled")
	).toBe(true);
});
