// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NewTaskWizard } from "./new-task-wizard";
import { studioMac } from "./wizard-test-fixtures";

// §19.3 (part 3, S4-T2): the connected GitHub step's repository control —
// search, URL paste (lookup), clear, and the issue input's dependency on a
// selected repository. The issue add/remove/Start flows live in
// wizard-github-issues.test.tsx; the not-connected state lives in
// new-task-wizard-start.test.tsx.

const STUDIO_MAC = /Studio Mac/;
const CLAUDE_CODE = /Claude Code/;
const OCTO_HELLO = /octo\/hello/;
const USE_OCTO_WORLD = /Use octo\/world/;

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

const store = vi.hoisted(() => ({
	computers: [] as unknown[],
	created: [] as Record<string, unknown>[],
	lookup: {} as Record<string, Record<string, unknown> | null>,
	navigatedTo: [] as Record<string, unknown>[],
	repos: [] as Record<string, unknown>[],
}));

vi.mock("sonner", () => ({ toast: { error: () => undefined } }));

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
			lookupRepository: byInput(
				"lookup",
				(input: { url: string }) => store.lookup[input.url] ?? null
			),
			searchIssues: byInput("issues", () => []),
			getIssue: byInput("issue", () => null),
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

afterEach(() => {
	store.computers = [];
	store.created.length = 0;
	store.lookup = {};
	store.navigatedTo.length = 0;
	store.repos = [];
	cleanup();
});

it("keeps issues disabled without a repository and enables them after picking one", async () => {
	store.repos = [HELLO_REPO];
	const view = renderWizard();
	await driveToGithubStep(view);

	const issues = view.getByLabelText("Linked issues") as HTMLInputElement;
	expect(issues.disabled).toBe(true);
	expect(issues.placeholder).toBe("Select a repository first");

	await pickRepository(view, OCTO_HELLO);

	const enabled = view.getByLabelText("Linked issues") as HTMLInputElement;
	expect(enabled.disabled).toBe(false);
});

it("selects a repository from search, shows it, and can clear it again", async () => {
	store.repos = [HELLO_REPO];
	const view = renderWizard();
	await driveToGithubStep(view);

	await pickRepository(view, OCTO_HELLO);
	expect(view.getByText("https://github.com/octo/hello")).toBeDefined();
	expect(view.queryByLabelText("GitHub repository")).toBeNull();

	fireEvent.click(view.getByRole("button", { name: "Clear repository" }));
	expect(view.getByLabelText("GitHub repository")).toBeDefined();
	expect(
		(view.getByLabelText("Linked issues") as HTMLInputElement).disabled
	).toBe(true);
});

it("locates a pasted URL through lookup and offers it as 'Use owner/repo'", async () => {
	store.lookup["https://github.com/octo/world"] = WORLD_REPO;
	const view = renderWizard();
	await driveToGithubStep(view);

	fireEvent.change(view.getByLabelText("GitHub repository"), {
		target: { value: "https://github.com/octo/world" },
	});
	fireEvent.click(await view.findByRole("button", { name: USE_OCTO_WORLD }));

	expect(view.getByText("octo/world")).toBeDefined();
	expect(view.getByText("https://github.com/octo/world")).toBeDefined();
});
