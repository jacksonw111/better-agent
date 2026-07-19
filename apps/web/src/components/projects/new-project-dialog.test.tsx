// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { within } from "@testing-library/dom";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NewProjectDialog } from "./new-project-dialog";
import { isValidGitUrl } from "./project-form-fields";

// Q3: the "New project" dialog — name + Git URL (any host, https or the ssh
// form, validated inline) + an OPTIONAL token that is omitted from the create
// call when left blank. Success closes the dialog and invalidates the project
// list (whose 5s poll then follows the clone — covered in
// project-list.test.tsx).

const NEW_PROJECT_PATTERN = /New project/;
const ACCESS_TOKEN_PATTERN = /Access token/;
const URL_ERROR_PATTERN = /Enter an https/;

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

function fillRequired(
	view: ReturnType<typeof renderDialog>,
	repoUrl = "https://github.com/acme/better-agent.git"
) {
	fireEvent.change(view.getByLabelText("Name"), {
		target: { value: "Better Agent" },
	});
	fireEvent.change(view.getByLabelText("Git URL"), {
		target: { value: repoUrl },
	});
}

it("accepts any https host and the ssh form, nothing else", () => {
	expect(isValidGitUrl("https://github.com/acme/better-agent.git")).toBe(true);
	expect(isValidGitUrl("https://gitlab.example.com/group/sub/repo.git")).toBe(
		true
	);
	expect(isValidGitUrl("git@git.company.io:group/repo.git")).toBe(true);
	expect(isValidGitUrl("owner/repo")).toBe(false);
	expect(isValidGitUrl("ftp://host/repo.git")).toBe(false);
	expect(isValidGitUrl("not a url")).toBe(false);
	expect(isValidGitUrl("")).toBe(false);
});

it("creates from a Git URL without a token when the optional field stays blank", async () => {
	const view = renderDialog();
	fillRequired(view);

	fireEvent.click(view.getByRole("button", { name: "Create project" }));

	await waitFor(() => {
		expect(store.createInputs).toHaveLength(1);
	});
	expect(store.createInputs[0]).toEqual({
		computerId: "computer-1",
		name: "Better Agent",
		repoUrl: "https://github.com/acme/better-agent.git",
		token: undefined,
	});
	// Success closes the dialog.
	await waitFor(() => {
		expect(view.queryByLabelText("Name")).toBeNull();
	});
});

it("creates from an ssh address and sends the token through a password field", async () => {
	const view = renderDialog();
	fillRequired(view, "git@git.company.io:group/repo.git");
	const tokenField = view.getByLabelText(ACCESS_TOKEN_PATTERN);
	expect(tokenField.getAttribute("type")).toBe("password");
	fireEvent.change(tokenField, { target: { value: "ghp_secret" } });

	fireEvent.click(view.getByRole("button", { name: "Create project" }));

	await waitFor(() => {
		expect(store.createInputs).toHaveLength(1);
	});
	expect(store.createInputs[0]).toMatchObject({
		repoUrl: "git@git.company.io:group/repo.git",
		token: "ghp_secret",
	});
});

it("keeps Create disabled and shows an inline error until the URL is a git URL", () => {
	const view = renderDialog();
	const create = view.getByRole("button", { name: "Create project" });
	expect(create.hasAttribute("disabled")).toBe(true);

	fireEvent.change(view.getByLabelText("Name"), {
		target: { value: "Better Agent" },
	});
	fireEvent.change(view.getByLabelText("Git URL"), {
		target: { value: "owner/repo" },
	});
	expect(create.hasAttribute("disabled")).toBe(true);
	expect(view.getByText(URL_ERROR_PATTERN)).toBeDefined();

	fireEvent.change(view.getByLabelText("Git URL"), {
		target: { value: "https://gitlab.example.com/group/repo.git" },
	});
	expect(view.queryByText(URL_ERROR_PATTERN)).toBeNull();
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
