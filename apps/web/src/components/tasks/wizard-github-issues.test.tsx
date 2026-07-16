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
import { NewTaskWizard } from "./new-task-wizard";
import { studioMac } from "./wizard-test-fixtures";

// §19.3 (part 4, S4-T2): the linked-issue flows of the wizard's GitHub step —
// dynamic ordered multi-issue add/remove (search + by number), issues cleared
// on a repository switch, the Start payload carrying repositoryFullName +
// issueNumbers in add order, and a not-found number surfacing a real toast.
// Repository picking itself is covered in wizard-step-github.test.tsx.

const STUDIO_MAC = /Studio Mac/;
const CLAUDE_CODE = /Claude Code/;
const OCTO_HELLO = /octo\/hello/;
const OCTO_WORLD = /octo\/world/;
const CRASH_ON_START = /Crash on start/;
const ADD_DARK_MODE = /Add dark mode/;

const HELLO_REPO = {
	fullName: "octo/hello",
	url: "https://github.com/octo/hello",
	cloneUrl: "https://github.com/octo/hello.git",
	defaultBranch: "main",
	private: false,
	description: "Says hello",
};

const WORLD_REPO = {
	...HELLO_REPO,
	fullName: "octo/world",
	url: "https://github.com/octo/world",
	description: null,
};

const CRASH_ISSUE = {
	number: 7,
	title: "Crash on start",
	url: "https://github.com/octo/hello/issues/7",
	state: "open" as const,
};

const DARK_MODE_DETAIL = {
	body: "",
	number: 9,
	title: "Add dark mode",
	url: "https://github.com/octo/hello/issues/9",
};

const store = vi.hoisted(() => ({
	computers: [] as unknown[],
	created: [] as Record<string, unknown>[],
	issueDetails: {} as Record<
		string,
		{ body: string; number: number; title: string; url: string } | null
	>,
	issues: [] as Record<string, unknown>[],
	navigatedTo: [] as Record<string, unknown>[],
	repos: [] as Record<string, unknown>[],
	toastErrors: [] as string[],
}));

vi.mock("sonner", () => ({
	toast: {
		error: (message: string) => {
			store.toastErrors.push(message);
		},
	},
}));

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, to }: { children?: React.ReactNode; to: string }) => (
		<a href={to}>{children}</a>
	),
	useNavigate: () => (opts: Record<string, unknown>) => {
		store.navigatedTo.push(opts);
	},
}));

/** Input-keyed queryOptions stub shared by the github procedure mocks. */
function byInput<I>(name: string, resolve: (input: I) => unknown) {
	return {
		queryOptions: ({ input }: { input: I }) => ({
			queryKey: ["github", name, JSON.stringify(input)],
			queryFn: () => Promise.resolve(resolve(input)),
		}),
	};
}

vi.mock("@/utils/orpc", () => ({
	orpc: {
		computers: {
			list: {
				key: () => ["computers", "list"],
				queryOptions: () => ({
					queryKey: ["computers", "list"],
					queryFn: () => Promise.resolve(store.computers),
				}),
			},
		},
		github: {
			status: {
				key: () => ["github", "status"],
				queryOptions: () => ({
					queryKey: ["github", "status"],
					queryFn: () => Promise.resolve({ connected: true }),
				}),
			},
			searchRepositories: byInput("repos", () => store.repos),
			lookupRepository: byInput("lookup", () => null),
			searchIssues: byInput("issues", () => store.issues),
			getIssue: byInput(
				"issue",
				(input: { fullName: string; number: number }) =>
					store.issueDetails[`${input.fullName}#${input.number}`] ?? null
			),
		},
		tasks: {
			create: {
				mutationOptions: (opts: Record<string, unknown>) => ({
					mutationFn: (args: Record<string, unknown>) => {
						store.created.push(args);
						return Promise.resolve({ runId: "run-1", taskId: "task-1" });
					},
					...opts,
				}),
			},
		},
	},
}));

function renderWizard() {
	store.computers = [studioMac];
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const { container } = render(
		<QueryClientProvider client={queryClient}>
			<NewTaskWizard />
		</QueryClientProvider>
	);
	return within(container);
}

type View = ReturnType<typeof renderWizard>;

async function driveToGithubStep(view: View) {
	fireEvent.click(await view.findByRole("radio", { name: STUDIO_MAC }));
	fireEvent.click(view.getByRole("radio", { name: CLAUDE_CODE }));
	fireEvent.click(view.getByRole("button", { name: "Next" }));
	fireEvent.change(view.getByLabelText("Task name"), {
		target: { value: "Fix login" },
	});
	fireEvent.change(view.getByLabelText("Task description"), {
		target: { value: "Make it pass" },
	});
	fireEvent.click(view.getByRole("button", { name: "Next" }));
	await view.findByLabelText("GitHub repository");
}

async function pickRepository(view: View, resultName: RegExp) {
	fireEvent.change(view.getByLabelText("GitHub repository"), {
		target: { value: "octo" },
	});
	fireEvent.click(await view.findByRole("button", { name: resultName }));
}

async function addIssueFromSearch(view: View, resultName: RegExp) {
	fireEvent.change(view.getByLabelText("Linked issues"), {
		target: { value: "crash" },
	});
	fireEvent.click(await view.findByRole("button", { name: resultName }));
}

async function addIssueByNumber(view: View, issueNumber: number) {
	fireEvent.change(view.getByLabelText("Linked issues"), {
		target: { value: String(issueNumber) },
	});
	fireEvent.click(
		await view.findByRole("button", { name: `Add issue #${issueNumber}` })
	);
}

afterEach(() => {
	store.computers = [];
	store.created.length = 0;
	store.issueDetails = {};
	store.issues = [];
	store.navigatedTo.length = 0;
	store.repos = [];
	store.toastErrors.length = 0;
	cleanup();
});

it("adds issues in order (search + by number), removes one, and clears on repo switch", async () => {
	store.repos = [HELLO_REPO, WORLD_REPO];
	store.issues = [CRASH_ISSUE];
	store.issueDetails["octo/hello#9"] = DARK_MODE_DETAIL;
	const view = renderWizard();
	await driveToGithubStep(view);
	await pickRepository(view, OCTO_HELLO);

	await addIssueFromSearch(view, CRASH_ON_START);
	await addIssueByNumber(view, DARK_MODE_DETAIL.number);

	// Ordered list: #7 (added first) before #9, both removable.
	await waitFor(() => {
		const list = view.getByRole("list", { name: "Added issues" });
		const rows = within(list).getAllByRole("listitem");
		expect(rows.map((row) => row.textContent)).toEqual([
			"#7 Crash on start",
			"#9 Add dark mode",
		]);
	});

	fireEvent.click(view.getByRole("button", { name: "Remove issue #7" }));
	const remaining = view.getByRole("list", { name: "Added issues" });
	expect(within(remaining).queryByText(CRASH_ON_START)).toBeNull();
	expect(within(remaining).getByText(ADD_DARK_MODE)).toBeDefined();

	// Switching to a different repository clears the linked issues (§8.4).
	fireEvent.click(view.getByRole("button", { name: "Clear repository" }));
	await pickRepository(view, OCTO_WORLD);
	expect(view.queryByText(ADD_DARK_MODE)).toBeNull();
});

it("Start sends repositoryFullName and issueNumbers in add order", async () => {
	store.repos = [HELLO_REPO];
	store.issues = [CRASH_ISSUE];
	store.issueDetails["octo/hello#9"] = DARK_MODE_DETAIL;
	const view = renderWizard();
	await driveToGithubStep(view);
	await pickRepository(view, OCTO_HELLO);
	await addIssueByNumber(view, DARK_MODE_DETAIL.number);
	await view.findByText(ADD_DARK_MODE);
	await addIssueFromSearch(view, CRASH_ON_START);

	fireEvent.click(view.getByRole("button", { name: "Start" }));

	await waitFor(() => {
		expect(store.created).toEqual([
			{
				agentKind: "claude-code",
				computerId: "computer-1",
				description: "Make it pass",
				issueNumbers: [DARK_MODE_DETAIL.number, CRASH_ISSUE.number],
				name: "Fix login",
				repositoryFullName: "octo/hello",
			},
		]);
	});
	expect(store.navigatedTo[0]).toMatchObject({ to: "/tasks/$taskId" });
});

it("a number that is not an issue in the repository surfaces a toast, adds nothing", async () => {
	store.repos = [HELLO_REPO];
	const view = renderWizard();
	await driveToGithubStep(view);
	await pickRepository(view, OCTO_HELLO);

	const missing = 404;
	await addIssueByNumber(view, missing);

	await waitFor(() => {
		expect(store.toastErrors).toEqual([
			"Issue #404 was not found in octo/hello",
		]);
	});
	expect(view.queryByRole("list", { name: "Added issues" })).toBeNull();
});
