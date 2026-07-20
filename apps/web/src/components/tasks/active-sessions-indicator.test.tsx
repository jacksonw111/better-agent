// @vitest-environment jsdom
// The global "what's still running for me" entry point. Sessions no longer end
// when you leave a page, so this indicator is the only way to find the ones
// still working — it must stay visible at zero (a hidden entry reads as "the
// feature is gone"), shout when a session is blocked on the user, and route
// straight into the chat. Popover content portals onto document.body, so these
// assertions query via `screen` and every render is torn down afterward.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ActiveSessionItem } from "./active-sessions";
import { ActiveSessionsIndicator } from "./active-sessions-indicator";

const store = {
	error: null as string | null,
	navigations: [] as string[],
	pending: false,
	sessions: [] as ActiveSessionItem[],
};

vi.mock("@/utils/orpc", () => ({
	orpc: {
		tasks: {
			listActive: {
				key: () => ["tasks", "listActive"],
				queryOptions: () => ({
					queryKey: ["tasks", "listActive"],
					queryFn: () => {
						if (store.error) {
							return Promise.reject(new Error(store.error));
						}
						if (store.pending) {
							return new Promise(() => {
								// never settles — exercises the loading state
							});
						}
						return Promise.resolve({ sessions: store.sessions });
					},
				}),
			},
		},
	},
}));

vi.mock("@tanstack/react-router", () => ({
	useNavigate:
		() => (options: { params?: { taskId?: string }; to: string }) => {
			store.navigations.push(options.params?.taskId ?? options.to);
			return Promise.resolve();
		},
}));

const MINUTE_MS = 60_000;

function makeActive(
	overrides: Partial<ActiveSessionItem> & { taskId: string }
): ActiveSessionItem {
	return {
		agentKind: "claude-code",
		computerId: "computer-1",
		computerName: "MacBook Pro",
		lastActivityAt: new Date(Date.now() - MINUTE_MS).toISOString(),
		name: "Fix login redirect",
		needsAttention: false,
		projectId: null,
		projectName: null,
		runId: `run-${overrides.taskId}`,
		status: "running",
		...overrides,
	};
}

function renderIndicator() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={queryClient}>
			<ActiveSessionsIndicator />
		</QueryClientProvider>
	);
}

function trigger() {
	return screen.getByTestId("active-sessions-trigger");
}

async function openPanel() {
	renderIndicator();
	await waitFor(() => expect(trigger()).toBeDefined());
	fireEvent.click(trigger());
	return await waitFor(() => screen.getByTestId("active-sessions-panel"));
}

afterEach(cleanup);
beforeEach(() => {
	store.error = null;
	store.navigations.length = 0;
	store.pending = false;
	store.sessions = [];
});

it("stays visible in a quiet state when nothing is running", async () => {
	renderIndicator();

	await waitFor(() => {
		expect(trigger().getAttribute("data-state")).toBe("idle");
	});
	expect(trigger().getAttribute("aria-label")).toBe("No active sessions");
	expect(screen.queryByTestId("active-sessions-count")).toBeNull();
});

it("badges the live count and reads it out", async () => {
	store.sessions = [
		makeActive({ taskId: "task-1" }),
		makeActive({ taskId: "task-2" }),
	];
	renderIndicator();

	await waitFor(() => {
		expect(screen.getByTestId("active-sessions-count").textContent).toBe("2");
	});
	expect(trigger().getAttribute("data-state")).toBe("running");
	expect(trigger().getAttribute("aria-label")).toBe("2 active sessions");
});

it("flips to the attention state when a session is waiting on the user", async () => {
	store.sessions = [
		makeActive({ taskId: "task-1" }),
		makeActive({
			needsAttention: true,
			status: "waiting_for_user",
			taskId: "task-2",
		}),
	];
	renderIndicator();

	await waitFor(() => {
		expect(trigger().getAttribute("data-state")).toBe("attention");
	});
	// The count still reports every live session; the label says who wants you.
	expect(screen.getByTestId("active-sessions-count").textContent).toBe("2");
	expect(trigger().getAttribute("aria-label")).toBe(
		"2 active sessions, 1 waiting for you"
	);
});

it("lists the sessions grouped by computer and project", async () => {
	store.sessions = [
		makeActive({ name: "Fix login redirect", taskId: "task-1" }),
		makeActive({
			name: "Bump deps",
			projectId: "project-1",
			projectName: "better-agent",
			taskId: "task-2",
		}),
		makeActive({
			computerId: "computer-2",
			computerName: "Studio",
			name: "Nightly crawl",
			taskId: "task-3",
		}),
	];
	const panel = await openPanel();

	expect(panel.textContent).toContain("MacBook Pro");
	expect(panel.textContent).toContain("Studio");
	expect(panel.textContent).toContain("better-agent");
	expect(panel.textContent).toContain("Fix login redirect");
	expect(panel.textContent).toContain("Nightly crawl");
	// Status and agent travel with each row, so the list is readable on its own.
	expect(panel.textContent).toContain("Running");
	expect(panel.textContent).toContain("Claude Code");
});

it("marks the session that is waiting on you", async () => {
	store.sessions = [
		makeActive({
			name: "Bump deps",
			needsAttention: true,
			status: "waiting_for_user",
			taskId: "task-2",
		}),
	];
	const panel = await openPanel();

	const row = screen.getByTestId("active-session-row-task-2");
	expect(row.getAttribute("data-attention")).toBe("true");
	expect(panel.textContent).toContain("Waiting for you");
});

it("navigates to a session's chat when its row is clicked", async () => {
	store.sessions = [makeActive({ taskId: "task-7" })];
	await openPanel();

	fireEvent.click(screen.getByTestId("active-session-row-task-7"));

	await waitFor(() => {
		expect(store.navigations).toEqual(["task-7"]);
	});
});

it("explains the empty state inside the panel", async () => {
	const panel = await openPanel();

	expect(panel.textContent).toContain("No sessions running");
});

it("shows a loading state while the first fetch is in flight", async () => {
	store.pending = true;
	const panel = await openPanel();

	expect(
		panel.querySelector('[data-testid="active-sessions-loading"]')
	).not.toBeNull();
});

it("surfaces a fetch failure inside the panel instead of a toast", async () => {
	store.error = "Network unreachable";
	const panel = await openPanel();

	await waitFor(() => {
		expect(panel.textContent).toContain("Network unreachable");
	});
});
