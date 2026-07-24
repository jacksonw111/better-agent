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
import type { ProfileStandard } from "@/utils/api-types";
import { StandardsSection } from "./standards-section";

const store = vi.hoisted(() => ({
	standards: [] as ProfileStandard[],
	calls: [] as { op: string; args: unknown }[],
	toastErrors: [] as string[],
}));

vi.mock("sonner", () => ({
	toast: {
		error: (message: string) => store.toastErrors.push(message),
		success: () => undefined,
	},
}));

// Streamdown pulls shiki/highlighting at import — irrelevant to this section,
// so stub the markdown renderer the dialog reaches for.
vi.mock("@better-agent/ui/components/response", () => ({
	Response: ({ children }: { children: string }) => <div>{children}</div>,
}));

function mutation(op: string) {
	return {
		mutationOptions: (opts: Record<string, unknown>) => ({
			mutationFn: (args: unknown) => {
				store.calls.push({ op, args });
				return Promise.resolve({ ok: true });
			},
			...opts,
		}),
	};
}

vi.mock("@/utils/orpc", () => ({
	orpc: {
		profiles: {
			get: {
				key: () => ["profiles", "get"],
				queryOptions: () => ({
					queryKey: ["profiles", "get"],
					queryFn: () =>
						Promise.resolve({
							standards: store.standards,
							templates: [],
							version: 3,
						}),
				}),
			},
			standards: {
				create: mutation("create"),
				update: mutation("update"),
				delete: mutation("delete"),
				reorder: mutation("reorder"),
			},
		},
	},
}));

function makeStandard(
	overrides: Partial<ProfileStandard> = {}
): ProfileStandard {
	return {
		id: "std-1",
		profileId: "profile-1",
		title: "Prefer const",
		body: "Use const by default across the codebase.",
		enabled: true,
		sortOrder: 0,
		createdAt: new Date("2026-07-23T00:00:00Z"),
		updatedAt: new Date("2026-07-23T00:00:00Z"),
		...overrides,
	};
}

function renderSection() {
	const queryClient = new QueryClient({
		defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
	});
	const { container } = render(
		<QueryClientProvider client={queryClient}>
			<StandardsSection />
		</QueryClientProvider>
	);
	return {
		body: within(container.ownerDocument.body),
		view: within(container),
	};
}

afterEach(() => {
	store.standards = [];
	store.calls.length = 0;
	store.toastErrors.length = 0;
	cleanup();
});

it("shows an empty state pointing at the global CLAUDE.md", async () => {
	const { view } = renderSection();
	await waitFor(() => {
		expect(view.getByText("No standards yet")).toBeDefined();
	});
	expect(
		view.getByRole("button", { name: "Add your first standard" })
	).toBeDefined();
});

it("lists a standard with its title", async () => {
	store.standards = [makeStandard()];
	const { view } = renderSection();
	await waitFor(() => {
		expect(view.getByText("Prefer const")).toBeDefined();
	});
});

it("toggles enabled through profiles.standards.update", async () => {
	store.standards = [makeStandard({ enabled: true })];
	const { view } = renderSection();
	await waitFor(() => {
		expect(view.getByText("Prefer const")).toBeDefined();
	});
	fireEvent.click(view.getByRole("switch", { name: "Enable Prefer const" }));
	await waitFor(() => {
		expect(store.calls).toContainEqual({
			op: "update",
			args: { standardId: "std-1", enabled: false },
		});
	});
});

it("reorders via profiles.standards.reorder when moving a row down", async () => {
	store.standards = [
		makeStandard({ id: "a", title: "First" }),
		makeStandard({ id: "b", title: "Second" }),
	];
	const { view } = renderSection();
	await waitFor(() => {
		expect(view.getByText("First")).toBeDefined();
	});
	fireEvent.click(view.getByRole("button", { name: "Move First down" }));
	await waitFor(() => {
		expect(store.calls).toContainEqual({
			op: "reorder",
			args: { orderedIds: ["b", "a"] },
		});
	});
});

it("deletes after confirming", async () => {
	store.standards = [makeStandard()];
	const { body, view } = renderSection();
	await waitFor(() => {
		expect(view.getByText("Prefer const")).toBeDefined();
	});
	fireEvent.click(view.getByRole("button", { name: "Delete" }));
	fireEvent.click(body.getByRole("button", { name: "Confirm" }));
	await waitFor(() => {
		expect(store.calls).toContainEqual({
			op: "delete",
			args: { standardId: "std-1" },
		});
	});
});
