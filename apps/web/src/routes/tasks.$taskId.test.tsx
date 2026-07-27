// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

// P25-B fix: /tasks/$taskId no longer renders a PTY "Open terminal" landing
// page — it redirects to the task's runtime session list. We render the route
// component directly (bypassing the router file harness) with Navigate stubbed
// to a div carrying its target, so we can assert where it sends the user.

const store = vi.hoisted(() => ({
	task: null as Record<string, unknown> | null,
}));

vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (opts: { component: unknown }) => ({
		...opts,
		useParams: () => ({ taskId: "task-1" }),
	}),
	Navigate: (props: { params?: Record<string, string>; to: string }) => (
		<div
			data-params={JSON.stringify(props.params)}
			data-testid="navigate"
			data-to={props.to}
		/>
	),
}));

vi.mock("@/utils/orpc", () => ({
	orpc: {
		tasks: {
			get: {
				queryOptions: (opts?: { input?: unknown }) => ({
					queryKey: ["tasks", "get", opts?.input],
					queryFn: () => Promise.resolve(store.task),
				}),
			},
		},
	},
}));

async function renderRoute() {
	const { Route } = await import("./tasks.$taskId");
	const Component = (Route as unknown as { component: () => React.ReactNode })
		.component;
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const { container } = render(
		<QueryClientProvider client={queryClient}>
			<Component />
		</QueryClientProvider>
	);
	return within(container);
}

afterEach(() => {
	store.task = null;
	cleanup();
	vi.resetModules();
});

it("redirects to the task's runtime session list", async () => {
	store.task = {
		task: {
			agentKind: "claude-code",
			computerId: "computer-9",
			name: "Session",
			projectId: null,
		},
		computerName: "Mac",
	};
	const view = await renderRoute();

	const nav = await waitFor(() => view.getByTestId("navigate"));
	expect(nav.getAttribute("data-to")).toBe(
		"/computers/$computerId/agents/$agentKind"
	);
	expect(JSON.parse(nav.getAttribute("data-params") ?? "{}")).toEqual({
		agentKind: "claude-code",
		computerId: "computer-9",
	});
});
