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
import type { ProjectTemplate } from "@/utils/api-types";
import { TemplatesSection } from "./templates-section";

const store = vi.hoisted(() => ({
	templates: [] as ProjectTemplate[],
	calls: [] as { op: string; args: unknown }[],
}));

vi.mock("sonner", () => ({
	toast: { error: () => undefined, success: () => undefined },
}));

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
		mcp: {
			listServers: {
				queryOptions: () => ({
					queryKey: ["mcp", "listServers"],
					queryFn: () => Promise.resolve([]),
				}),
			},
		},
		profiles: {
			get: {
				key: () => ["profiles", "get"],
				queryOptions: () => ({
					queryKey: ["profiles", "get"],
					queryFn: () =>
						Promise.resolve({
							standards: [],
							templates: store.templates,
							version: 1,
						}),
				}),
			},
			templates: {
				create: mutation("create"),
				update: mutation("update"),
				delete: mutation("delete"),
			},
		},
	},
}));

function makeTemplate(
	overrides: Partial<ProjectTemplate> = {}
): ProjectTemplate {
	return {
		id: "tpl-1",
		profileId: "profile-1",
		name: "Node service",
		description: "A REST service",
		scaffold: { dirs: ["src"], files: [{ content: "x", path: "a.txt" }] },
		claudeMd: null,
		mcpServerIds: [],
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
			<TemplatesSection />
		</QueryClientProvider>
	);
	return {
		body: within(container.ownerDocument.body),
		view: within(container),
	};
}

afterEach(() => {
	store.templates = [];
	store.calls.length = 0;
	cleanup();
});

it("shows an empty state when there are no templates", async () => {
	const { view } = renderSection();
	await waitFor(() => {
		expect(view.getByText("No templates yet")).toBeDefined();
	});
});

it("lists a template with its name and scaffold counts", async () => {
	store.templates = [makeTemplate()];
	const { view } = renderSection();
	await waitFor(() => {
		expect(view.getByText("Node service")).toBeDefined();
	});
	expect(view.getByText("1 files · 1 dirs · 0 MCP")).toBeDefined();
});

it("deletes a template after confirming", async () => {
	store.templates = [makeTemplate()];
	const { body, view } = renderSection();
	await waitFor(() => {
		expect(view.getByText("Node service")).toBeDefined();
	});
	fireEvent.click(view.getByRole("button", { name: "Delete" }));
	fireEvent.click(body.getByRole("button", { name: "Confirm" }));
	await waitFor(() => {
		expect(store.calls).toContainEqual({
			op: "delete",
			args: { templateId: "tpl-1" },
		});
	});
});
