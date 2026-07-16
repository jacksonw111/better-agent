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
import { NewTaskWizard } from "./new-task-wizard";
import { studioMac, travelLaptop } from "./wizard-test-fixtures";

// §19.3 (part 1): the Step 1 dependency chain and the palette-only "/"
// autocomplete. Start-path cases live in new-task-wizard-start.test.tsx.

const STUDIO_MAC = /Studio Mac/;
const TRAVEL_LAPTOP = /Travel Laptop/;
const CLAUDE_CODE = /Claude Code/;
const CODEX = /Codex/;
const RESEARCH = /research/;
const TO_SPEC = /to-spec/;
const GIT_OR_GH = /git|gh/;

const store = vi.hoisted(() => ({
	computers: [] as unknown[],
	created: [] as Record<string, unknown>[],
	navigatedTo: [] as Record<string, unknown>[],
}));

vi.mock("sonner", () => ({ toast: { error: () => undefined } }));

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

function renderWizard(computers: ComputerListItem[] = [studioMac]) {
	store.computers = computers;
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

async function pickComputer(view: View, name: RegExp) {
	fireEvent.click(await view.findByRole("radio", { name }));
}

function pickRuntime(view: View, name: RegExp) {
	fireEvent.click(view.getByRole("radio", { name }));
}

function description(view: View): HTMLTextAreaElement {
	return view.getByLabelText("Task description") as HTMLTextAreaElement;
}

afterEach(() => {
	store.computers = [];
	store.created.length = 0;
	store.navigatedTo.length = 0;
	cleanup();
});

it("reveals runtimes only after a computer is picked, scoped to its inventory", async () => {
	const view = renderWizard([studioMac, travelLaptop]);

	expect(await view.findByRole("radio", { name: STUDIO_MAC })).toBeDefined();
	expect(view.queryByRole("radiogroup", { name: "Agent runtime" })).toBeNull();

	await pickComputer(view, TRAVEL_LAPTOP);

	expect(view.getByRole("radio", { name: CODEX })).toBeDefined();
	expect(view.queryByRole("radio", { name: CLAUDE_CODE })).toBeNull();
});

it("shows read-only git/gh facts and the palette only after a runtime is picked", async () => {
	const view = renderWizard();

	await pickComputer(view, STUDIO_MAC);
	expect(view.queryByText("git installed")).toBeNull();

	pickRuntime(view, CLAUDE_CODE);

	expect(view.getByText("git installed")).toBeDefined();
	expect(view.getByText("gh missing")).toBeDefined();
	// Facts, not controls: nothing about git/gh is checkable.
	expect(view.queryByRole("checkbox", { name: GIT_OR_GH })).toBeNull();
	expect(view.getByText("Skill palette")).toBeDefined();
	expect(view.getByRole("checkbox", { name: RESEARCH })).toBeDefined();
});

it("hides the whole skill palette block for a capability-none runtime", async () => {
	const view = renderWizard();

	await pickComputer(view, STUDIO_MAC);
	pickRuntime(view, CODEX);

	expect(view.getByText("git installed")).toBeDefined();
	expect(view.queryByText("Skill palette")).toBeNull();
	expect(view.queryByRole("checkbox")).toBeNull();
});

it("clears an incompatible runtime and resets the palette when the computer changes", async () => {
	const view = renderWizard([studioMac, travelLaptop]);

	await pickComputer(view, STUDIO_MAC);
	pickRuntime(view, CLAUDE_CODE);
	fireEvent.click(view.getByRole("checkbox", { name: RESEARCH }));

	await pickComputer(view, TRAVEL_LAPTOP);

	// claude-code is not on the laptop: runtime cleared, downstream gone.
	expect(view.queryByRole("radio", { name: CLAUDE_CODE })).toBeNull();
	expect(view.queryByText("git installed")).toBeNull();
	expect(view.queryByText("Skill palette")).toBeNull();

	// Back on the Mac the old palette selection did not survive.
	await pickComputer(view, STUDIO_MAC);
	pickRuntime(view, CLAUDE_CODE);
	const research = view.getByRole("checkbox", { name: RESEARCH });
	expect(research.getAttribute("aria-checked")).toBe("false");
});

it("keeps a still-compatible runtime when the computer changes", async () => {
	const view = renderWizard([studioMac, travelLaptop]);

	await pickComputer(view, STUDIO_MAC);
	pickRuntime(view, CODEX);
	await pickComputer(view, TRAVEL_LAPTOP);

	const codex = view.getByRole("radio", { name: CODEX }) as HTMLInputElement;
	expect(codex.checked).toBe(true);
});

it("never touches the description when palette skills are toggled", async () => {
	const view = renderWizard();

	await pickComputer(view, STUDIO_MAC);
	pickRuntime(view, CLAUDE_CODE);
	fireEvent.click(view.getByRole("checkbox", { name: RESEARCH }));
	fireEvent.click(view.getByRole("button", { name: "Next" }));

	expect(description(view).value).toBe("");
	fireEvent.change(description(view), { target: { value: "hello" } });

	// Round-trip to Step 1, toggle more skills, come back: text untouched.
	fireEvent.click(view.getByRole("button", { name: "Back" }));
	fireEvent.click(view.getByRole("checkbox", { name: TO_SPEC }));
	fireEvent.click(view.getByRole("button", { name: "Next" }));
	expect(description(view).value).toBe("hello");
});

it("offers only palette-checked skills in the '/' autocomplete", async () => {
	const view = renderWizard();

	await pickComputer(view, STUDIO_MAC);
	pickRuntime(view, CLAUDE_CODE);
	fireEvent.click(view.getByRole("checkbox", { name: RESEARCH }));
	fireEvent.click(view.getByRole("button", { name: "Next" }));

	fireEvent.change(description(view), { target: { value: "/" } });

	expect(view.getByRole("option", { name: "research" })).toBeDefined();
	expect(view.queryByRole("option", { name: "to-spec" })).toBeNull();

	// Unknown slash text stays plain text — no picker, no hidden behavior.
	fireEvent.change(description(view), { target: { value: "/nope" } });
	expect(view.queryByRole("listbox")).toBeNull();
});

it("inserts /skill-name at the cursor, repeatedly", async () => {
	const view = renderWizard();

	await pickComputer(view, STUDIO_MAC);
	pickRuntime(view, CLAUDE_CODE);
	fireEvent.click(view.getByRole("checkbox", { name: RESEARCH }));
	fireEvent.click(view.getByRole("checkbox", { name: TO_SPEC }));
	fireEvent.click(view.getByRole("button", { name: "Next" }));

	fireEvent.change(description(view), { target: { value: "/res" } });
	fireEvent.mouseDown(view.getByRole("option", { name: "research" }));
	expect(description(view).value).toBe("/research ");
	expect(view.queryByRole("listbox")).toBeNull();

	fireEvent.change(description(view), {
		target: { value: "/research then /to" },
	});
	fireEvent.mouseDown(view.getByRole("option", { name: "to-spec" }));
	expect(description(view).value).toBe("/research then /to-spec ");
	await waitFor(() => {
		expect(description(view).selectionStart).toBe(
			"/research then /to-spec ".length
		);
	});
});

it("selects with arrow keys and Enter without submitting anything", async () => {
	const view = renderWizard();

	await pickComputer(view, STUDIO_MAC);
	pickRuntime(view, CLAUDE_CODE);
	fireEvent.click(view.getByRole("checkbox", { name: RESEARCH }));
	fireEvent.click(view.getByRole("checkbox", { name: TO_SPEC }));
	fireEvent.click(view.getByRole("button", { name: "Next" }));

	fireEvent.change(description(view), { target: { value: "/" } });
	fireEvent.keyDown(description(view), { key: "ArrowDown" });
	fireEvent.keyDown(description(view), { key: "Enter" });

	expect(description(view).value).toBe("/to-spec ");
	expect(store.created).toEqual([]);
});
