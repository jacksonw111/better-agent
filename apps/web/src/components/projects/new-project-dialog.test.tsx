// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { within } from "@testing-library/dom";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NewProjectDialog } from "./new-project-dialog";

// Q3: the "New project" dialog — name + owner/repo (validated) + an OPTIONAL
// token that is omitted from the create call when left blank. Success closes
// the dialog and invalidates the project list (whose 5s poll then follows the
// clone to ready/error — covered in project-list.test.tsx).

const NEW_PROJECT_PATTERN = /New project/;
const ACCESS_TOKEN_PATTERN = /Access token/;

const store = vi.hoisted(() => ({
	createInputs: [] as Record<string, unknown>[],
	failCreate: false,
}));

vi.mock("sonner", () => ({ toast: { error: () => undefined } }));

vi.mock("@/utils/orpc", () => ({
	orpc: {
		projects: {
			create: {
				mutationOptions: (opts: Record<string, unknown>) => ({
					mutationFn: (input: Record<string, unknown>) => {
						store.createInputs.push(input);
						return store.failCreate
							? Promise.reject(new Error("Computer is offline"))
							: Promise.resolve({ id: "project-1" });
					},
					...opts,
				}),
			},
			list: { key: () => ["projects", "list"] },
		},
	},
}));

function renderDialog() {
	const queryClient = new QueryClient({
		defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
	});
	const { container } = render(
		<QueryClientProvider client={queryClient}>
			<NewProjectDialog computerId="computer-1" />
		</QueryClientProvider>
	);
	const view = within(container.ownerDocument.body);
	fireEvent.click(view.getByRole("button", { name: NEW_PROJECT_PATTERN }));
	return view;
}

afterEach(() => {
	store.createInputs.length = 0;
	store.failCreate = false;
	cleanup();
});

function fillRequired(view: ReturnType<typeof renderDialog>) {
	fireEvent.change(view.getByLabelText("Name"), {
		target: { value: "Better Agent" },
	});
	fireEvent.change(view.getByLabelText("GitHub repository"), {
		target: { value: "acme/better-agent" },
	});
}

it("creates without a token when the optional field stays blank", async () => {
	const view = renderDialog();
	fillRequired(view);

	fireEvent.click(view.getByRole("button", { name: "Create project" }));

	await waitFor(() => {
		expect(store.createInputs).toHaveLength(1);
	});
	expect(store.createInputs[0]).toEqual({
		computerId: "computer-1",
		name: "Better Agent",
		repoFullName: "acme/better-agent",
		token: undefined,
	});
	// Success closes the dialog.
	await waitFor(() => {
		expect(view.queryByLabelText("Name")).toBeNull();
	});
});

it("sends the token when provided, through a password field", async () => {
	const view = renderDialog();
	fillRequired(view);
	const tokenField = view.getByLabelText(ACCESS_TOKEN_PATTERN);
	expect(tokenField.getAttribute("type")).toBe("password");
	fireEvent.change(tokenField, { target: { value: "ghp_secret" } });

	fireEvent.click(view.getByRole("button", { name: "Create project" }));

	await waitFor(() => {
		expect(store.createInputs).toHaveLength(1);
	});
	expect(store.createInputs[0].token).toBe("ghp_secret");
});

it("keeps Create disabled until the repository looks like owner/repo", () => {
	const view = renderDialog();
	const create = view.getByRole("button", { name: "Create project" });
	expect(create.hasAttribute("disabled")).toBe(true);

	fireEvent.change(view.getByLabelText("Name"), {
		target: { value: "Better Agent" },
	});
	fireEvent.change(view.getByLabelText("GitHub repository"), {
		target: { value: "not-a-repo" },
	});
	expect(create.hasAttribute("disabled")).toBe(true);

	fireEvent.change(view.getByLabelText("GitHub repository"), {
		target: { value: "acme/better-agent" },
	});
	expect(create.hasAttribute("disabled")).toBe(false);
});

it("stays open on a failed create so the draft can be fixed", async () => {
	store.failCreate = true;
	const view = renderDialog();
	fillRequired(view);

	fireEvent.click(view.getByRole("button", { name: "Create project" }));

	await waitFor(() => {
		expect(store.createInputs).toHaveLength(1);
	});
	expect(view.getByLabelText("Name")).toBeDefined();
});
