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
import { ComputerList } from "./computer-list";

const META_LINE_PATTERN = /darwin · arm64 · Client 0\.3\.0/;
const AUTH_CLAIM_PATTERN = /authenticated/i;

const store = vi.hoisted(() => ({
	computers: [] as unknown[],
	deleteArgs: [] as Record<string, unknown>[],
	deleteError: null as Error | null,
	toastErrors: [] as string[],
}));

vi.mock("sonner", () => ({
	toast: {
		error: (message: string) => {
			store.toastErrors.push(message);
		},
	},
}));

vi.mock("@better-agent/env/web", () => ({
	env: { VITE_SERVER_URL: "https://server.example.com" },
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
			delete: {
				mutationOptions: (opts: Record<string, unknown>) => ({
					mutationFn: (args: Record<string, unknown>) => {
						store.deleteArgs.push(args);
						return store.deleteError
							? Promise.reject(store.deleteError)
							: Promise.resolve({ ok: true });
					},
					...opts,
				}),
			},
			createPairingCode: {
				mutationOptions: (opts: Record<string, unknown>) => ({
					mutationFn: () =>
						Promise.resolve({ code: "pc_test123", expiresAt: new Date() }),
					...opts,
				}),
			},
		},
	},
}));

function makeComputer(
	overrides: Partial<ComputerListItem> = {}
): ComputerListItem {
	return {
		id: "computer-1",
		name: "Studio Mac",
		platform: "darwin",
		arch: "arm64",
		clientVersion: "0.3.0",
		connected: true,
		createdAt: new Date("2026-07-15T10:00:00.000Z"),
		lastSeenAt: new Date("2026-07-15T12:00:00.000Z"),
		runtimeInventory: [
			{
				agentKind: "claude-code",
				skillCapability: "discoverable",
				skills: [
					{ name: "research", description: "deep research" },
					{ name: "to-spec", description: "spec writer" },
				],
			},
			{ agentKind: "codex", skillCapability: "none", skills: [] },
		],
		toolInventory: [
			{ name: "git", installed: true },
			{ name: "gh", installed: false },
		],
		...overrides,
	};
}

function renderList() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const { container } = render(
		<QueryClientProvider client={queryClient}>
			<ComputerList />
		</QueryClientProvider>
	);
	return {
		body: within(container.ownerDocument.body),
		view: within(container),
	};
}

afterEach(() => {
	store.computers = [];
	store.deleteArgs.length = 0;
	store.deleteError = null;
	store.toastErrors.length = 0;
	cleanup();
});

it("shows an empty state that points at the pair button", async () => {
	const { view } = renderList();

	await waitFor(() => {
		expect(view.getByText("No computers paired")).toBeDefined();
	});
	expect(view.getByRole("button", { name: "Pair new computer" })).toBeDefined();
});

it("shows a connected computer with its attributes, runtimes and tool facts", async () => {
	store.computers = [makeComputer()];
	const { view } = renderList();

	await waitFor(() => {
		expect(view.getByText("Studio Mac")).toBeDefined();
	});
	expect(view.getByText("Connected")).toBeDefined();
	expect(view.getByText(META_LINE_PATTERN)).toBeDefined();
	// Discoverable runtime shows its skill count; capability "none" shows none.
	expect(view.getByText("Claude Code · 2 skills")).toBeDefined();
	expect(view.getByText("Codex")).toBeDefined();
	// git/gh are read-only installed facts — never authentication claims.
	expect(view.getByText("git installed")).toBeDefined();
	expect(view.getByText("gh missing")).toBeDefined();
	expect(view.queryByText(AUTH_CLAIM_PATTERN)).toBeNull();
});

it("shows an offline computer without hiding it", async () => {
	store.computers = [
		makeComputer({
			id: "computer-2",
			name: "Travel Laptop",
			connected: false,
			runtimeInventory: [],
			toolInventory: [],
		}),
	];
	const { view } = renderList();

	await waitFor(() => {
		expect(view.getByText("Travel Laptop")).toBeDefined();
	});
	expect(view.getByText("Offline")).toBeDefined();
	expect(view.getByText("No supported runtimes detected")).toBeDefined();
});

it("deletes a computer only after confirming", async () => {
	store.computers = [makeComputer()];
	const { body, view } = renderList();

	await waitFor(() => {
		expect(view.getByText("Studio Mac")).toBeDefined();
	});
	fireEvent.click(view.getByRole("button", { name: "Delete" }));
	fireEvent.click(body.getByRole("button", { name: "Confirm" }));

	await waitFor(() => {
		expect(store.deleteArgs).toEqual([{ id: "computer-1" }]);
	});
});

it("surfaces a delete failure as an error toast", async () => {
	store.computers = [makeComputer()];
	store.deleteError = new Error("Computer not found");
	const { body, view } = renderList();

	await waitFor(() => {
		expect(view.getByText("Studio Mac")).toBeDefined();
	});
	fireEvent.click(view.getByRole("button", { name: "Delete" }));
	fireEvent.click(body.getByRole("button", { name: "Confirm" }));

	await waitFor(() => {
		expect(store.toastErrors).toEqual(["Computer not found"]);
	});
});
