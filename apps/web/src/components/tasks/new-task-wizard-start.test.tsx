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
import type { ComputerListItem } from "@/utils/api-types";
import { NewTaskDialog } from "./new-task-dialog";
import { offlineBox, studioMac } from "./wizard-test-fixtures";

// §19.3 (part 2), asserted inside the New Task modal: required-field
// interception on Request, the no-connection GitHub step with a direct
// no-Review Start, and the Start success / failure / offline paths — a
// successful Start closes the modal, a failed one leaves it open. Step 1
// chain cases live in new-task-wizard.test.tsx; the connected Step 3 flows
// live in wizard-step-github.test.tsx.

const STUDIO_MAC = /Studio Mac/;
const OFFLINE_BOX = /Offline Box/;
const CLAUDE_CODE = /Claude Code/;
const REVIEW_PATTERN = /review/i;
const OFFLINE_HINT = /This computer is offline/;

const store = vi.hoisted(() => ({
	computers: [] as unknown[],
	createError: null as Error | null,
	created: [] as Record<string, unknown>[],
	githubConnected: false,
	navigatedTo: [] as Record<string, unknown>[],
	openChanges: [] as boolean[],
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
	Link: ({
		children,
		className,
		to,
	}: {
		children?: React.ReactNode;
		className?: string;
		to: string;
	}) => (
		<a className={className} href={to}>
			{children}
		</a>
	),
	useNavigate: () => (opts: Record<string, unknown>) => {
		store.navigatedTo.push(opts);
	},
}));

/** Inert input-keyed queryOptions stub — these tests never connect GitHub,
 * so every search/lookup procedure just resolves an empty result. */
function inertQuery<T>(name: string, result: T) {
	return {
		queryOptions: ({ input }: { input: unknown }) => ({
			queryKey: ["github", name, JSON.stringify(input)],
			queryFn: () => Promise.resolve(result),
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
					queryFn: () => Promise.resolve({ connected: store.githubConnected }),
				}),
			},
			searchRepositories: inertQuery("repos", []),
			lookupRepository: inertQuery("lookup", null),
			searchIssues: inertQuery("issues", []),
			getIssue: inertQuery("issue", null),
		},
		tasks: {
			create: {
				mutationOptions: (opts: Record<string, unknown>) => ({
					mutationFn: (args: Record<string, unknown>) => {
						store.created.push(args);
						return store.createError
							? Promise.reject(store.createError)
							: Promise.resolve({ runId: "run-1", taskId: "task-1" });
					},
					...opts,
				}),
			},
		},
	},
}));

function renderWizard(computers: ComputerListItem[] = [studioMac]) {
	store.computers = computers;
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	// The dialog renders through a portal, so queries scope to document.body.
	const { container } = render(
		<QueryClientProvider client={queryClient}>
			<NewTaskDialog
				onOpenChange={(next: boolean) => {
					store.openChanges.push(next);
				}}
				open
			/>
		</QueryClientProvider>
	);
	return within(container.ownerDocument.body);
}

type View = ReturnType<typeof renderWizard>;

async function driveToRequestStep(view: View, computerName: RegExp) {
	fireEvent.click(await view.findByRole("radio", { name: computerName }));
	fireEvent.click(view.getByRole("radio", { name: CLAUDE_CODE }));
	fireEvent.click(view.getByRole("button", { name: "Next" }));
}

function fillRequest(view: View, name: string, describeText: string) {
	fireEvent.change(view.getByLabelText("Task name"), {
		target: { value: name },
	});
	fireEvent.change(view.getByLabelText("Task description"), {
		target: { value: describeText },
	});
}

function clickNext(view: View) {
	fireEvent.click(view.getByRole("button", { name: "Next" }));
}

const GITHUB_STEP = /Optionally attach a GitHub repository/;
const CONNECT_HINT = /GitHub is not connected/;

afterEach(() => {
	store.computers = [];
	store.createError = null;
	store.created.length = 0;
	store.githubConnected = false;
	store.navigatedTo.length = 0;
	store.openChanges.length = 0;
	store.toastErrors.length = 0;
	cleanup();
});

it("blocks advancing past Request until name and description are filled", async () => {
	const view = renderWizard();
	await driveToRequestStep(view, STUDIO_MAC);

	clickNext(view);
	expect(view.getByText("Task name is required")).toBeDefined();
	expect(view.getByText("Task description is required")).toBeDefined();
	expect(view.queryByText(GITHUB_STEP)).toBeNull();

	fireEvent.change(view.getByLabelText("Task name"), {
		target: { value: "Fix login" },
	});
	clickNext(view);
	expect(view.getByText("Task description is required")).toBeDefined();
	expect(view.queryByText(GITHUB_STEP)).toBeNull();

	fireEvent.change(view.getByLabelText("Task description"), {
		target: { value: "Make the login test pass" },
	});
	clickNext(view);
	expect(await view.findByText(GITHUB_STEP)).toBeDefined();
});

it("without a GitHub connection: hint + disabled controls, Start still usable", async () => {
	const view = renderWizard();
	await driveToRequestStep(view, STUDIO_MAC);
	fillRequest(view, "Fix login", "Make the login test pass");
	clickNext(view);

	// The connection hint points at Integrations; the controls stay disabled.
	expect(await view.findByText(CONNECT_HINT)).toBeDefined();
	const repository = view.getByLabelText("GitHub repository");
	expect(repository.hasAttribute("disabled")).toBe(true);
	const issues = view.getByLabelText("Linked issues");
	expect(issues.hasAttribute("disabled")).toBe(true);

	// Direct Start, no Review step in between (spec §18.2).
	const start = view.getByRole("button", {
		name: "Start",
	}) as HTMLButtonElement;
	expect(start.disabled).toBe(false);
	expect(view.queryByText(REVIEW_PATTERN)).toBeNull();
});

it("creates the task on Start, closes the modal and navigates into its conversation", async () => {
	const view = renderWizard();
	await driveToRequestStep(view, STUDIO_MAC);
	fillRequest(view, "Fix login", "Make it pass. Use /research first.");
	clickNext(view);

	fireEvent.click(view.getByRole("button", { name: "Start" }));

	await waitFor(() => {
		expect(store.navigatedTo[0]).toMatchObject({
			params: { taskId: "task-1" },
			to: "/tasks/$taskId",
		});
	});
	expect(store.created).toEqual([
		{
			agentKind: "claude-code",
			computerId: "computer-1",
			description: "Make it pass. Use /research first.",
			name: "Fix login",
		},
	]);
	// A successful Start closes the modal — no discard confirmation.
	expect(store.openChanges).toEqual([false]);
	expect(view.queryByText("Discard this task?")).toBeNull();
});

it("keeps the modal open and shows the real error when Start fails", async () => {
	store.createError = new Error(
		"Computer is offline — reconnect it or pick another one"
	);
	const view = renderWizard();
	await driveToRequestStep(view, STUDIO_MAC);
	fillRequest(view, "Fix login", "Make the login test pass");
	clickNext(view);

	fireEvent.click(view.getByRole("button", { name: "Start" }));

	await waitFor(() => {
		expect(store.toastErrors).toEqual([
			"Computer is offline — reconnect it or pick another one",
		]);
	});
	expect(store.navigatedTo).toEqual([]);
	// The modal never asked to close — the wizard stays exactly where it was.
	expect(store.openChanges).toEqual([]);
	expect(view.getByRole("button", { name: "Start" })).toBeDefined();
	expect(await view.findByText(GITHUB_STEP)).toBeDefined();
});

it("lets an offline computer be inspected but never started", async () => {
	const view = renderWizard([offlineBox]);
	await driveToRequestStep(view, OFFLINE_BOX);
	fillRequest(view, "Fix login", "Make the login test pass");
	clickNext(view);

	const start = view.getByRole("button", {
		name: "Start",
	}) as HTMLButtonElement;
	expect(start.disabled).toBe(true);
	expect(view.getByText(OFFLINE_HINT)).toBeDefined();
	fireEvent.click(start);
	expect(store.created).toEqual([]);
});
