// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { within } from "@testing-library/dom";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EditProjectDialog } from "./edit-project-dialog";
import { makeProject, readyProject } from "./project-fixtures";

// The Edit dialog: prefilled name + Git URL, token blank-means-keep. Only the
// CHANGED fields travel — an unchanged Git URL is omitted so a rename alone
// never re-clones, and Save stays disabled until something actually changed.

const RECLONE_HINT_PATTERN = /clones the repository again/;
const TOKEN_LABEL_PATTERN = /token/i;

const store = vi.hoisted(() => ({
	toasts: [] as string[],
	updateError: null as Error | null,
	updateInputs: [] as Record<string, unknown>[],
}));

vi.mock("sonner", () => ({
	toast: {
		error: (message: string) => {
			store.toasts.push(`error:${message}`);
		},
		success: (message: string) => {
			store.toasts.push(`success:${message}`);
		},
	},
}));

vi.mock("@/utils/orpc", () => ({
	orpc: {
		projects: {
			get: { key: () => ["projects", "get"] },
			list: { key: () => ["projects", "list"] },
			update: {
				mutationOptions: (opts: Record<string, unknown>) => ({
					mutationFn: (input: Record<string, unknown>) => {
						store.updateInputs.push(input);
						return store.updateError
							? Promise.reject(store.updateError)
							: Promise.resolve({ id: "project-1", status: "ready" });
					},
					...opts,
				}),
			},
		},
	},
}));

function renderDialog(project = readyProject) {
	const queryClient = new QueryClient({
		defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
	});
	const { container } = render(
		<QueryClientProvider client={queryClient}>
			<EditProjectDialog project={project} />
		</QueryClientProvider>
	);
	const view = within(container.ownerDocument.body);
	fireEvent.click(view.getByRole("button", { name: "Edit" }));
	return view;
}

afterEach(() => {
	store.toasts.length = 0;
	store.updateError = null;
	store.updateInputs.length = 0;
	cleanup();
});

it("prefills the current name and Git URL and keeps Save disabled until a change", () => {
	const view = renderDialog();

	expect((view.getByLabelText("Name") as HTMLInputElement).value).toBe(
		"Better Agent"
	);
	expect((view.getByLabelText("Git URL") as HTMLInputElement).value).toBe(
		"https://github.com/acme/better-agent.git"
	);
	// The helper copy explains blank-keeps and that URL/token changes re-clone.
	expect(view.getByText(RECLONE_HINT_PATTERN)).toBeDefined();
	expect(
		view.getByRole("button", { name: "Save changes" }).hasAttribute("disabled")
	).toBe(true);
});

it("a rename sends ONLY the name — never the unchanged Git URL", async () => {
	const view = renderDialog();
	fireEvent.change(view.getByLabelText("Name"), {
		target: { value: "Renamed" },
	});

	fireEvent.click(view.getByRole("button", { name: "Save changes" }));

	await waitFor(() => {
		expect(store.updateInputs).toHaveLength(1);
	});
	expect(store.updateInputs[0]).toEqual({
		name: "Renamed",
		projectId: "project-1",
	});
	expect(store.toasts).toEqual(["success:Project updated"]);
	// Success closes the dialog.
	await waitFor(() => {
		expect(view.queryByLabelText("Name")).toBeNull();
	});
});

it("a changed Git URL and a filled token travel together and announce the re-clone", async () => {
	const view = renderDialog(makeProject({ status: "error" }));
	fireEvent.change(view.getByLabelText("Git URL"), {
		target: { value: "https://gitlab.example.com/group/agent.git" },
	});
	fireEvent.change(view.getByLabelText(TOKEN_LABEL_PATTERN), {
		target: { value: "glpat_new" },
	});

	fireEvent.click(view.getByRole("button", { name: "Save changes" }));

	await waitFor(() => {
		expect(store.updateInputs).toHaveLength(1);
	});
	expect(store.updateInputs[0]).toEqual({
		projectId: "project-1",
		repoUrl: "https://gitlab.example.com/group/agent.git",
		token: "glpat_new",
	});
});

it("keeps Save disabled for an invalid Git URL", () => {
	const view = renderDialog();
	fireEvent.change(view.getByLabelText("Git URL"), {
		target: { value: "not a url" },
	});
	expect(
		view.getByRole("button", { name: "Save changes" }).hasAttribute("disabled")
	).toBe(true);
});

it("stays open on a failed save so the draft can be fixed", async () => {
	store.updateError = new Error("Computer is offline");
	const view = renderDialog();
	fireEvent.change(view.getByLabelText("Name"), {
		target: { value: "Renamed" },
	});

	fireEvent.click(view.getByRole("button", { name: "Save changes" }));

	await waitFor(() => {
		expect(store.toasts).toEqual(["error:Computer is offline"]);
	});
	expect(view.getByLabelText("Name")).toBeDefined();
});
