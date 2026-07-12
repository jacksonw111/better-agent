// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	waitFor,
	within,
} from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BridgeTokenRow } from "@/utils/api-types";
import { LocalAgentSettingsDialog } from "./local-agent-settings-dialog";

// R5-a: the assigned-MCP-servers picker's own coverage, split out of
// local-agent-settings-dialog.test.tsx purely to keep that file under the
// repo's 300-line limit (same split as local-agent-settings-dialog-skills.test.tsx
// for the skills picker). Duplicates the shared mock harness since vi.mock is
// scoped per test file.

vi.mock("sonner", () => ({
	toast: { error: vi.fn(), success: vi.fn() },
}));

// McpServersField renders a <Link> to /integrations in its empty state —
// outside a RouterProvider that throws, so it's swapped for a plain anchor.
vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		to,
		...props
	}: AnchorHTMLAttributes<HTMLAnchorElement> & {
		children: ReactNode;
		to: string;
	}) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
}));

const NOTION_CHECKBOX_RE = /Notion/;
const LINEAR_CHECKBOX_RE = /Linear/;

const store = vi.hoisted(() => ({
	saveArgs: [] as Record<string, unknown>[],
	mcpServers: [
		{ id: "mcp-1", name: "Notion", url: "https://mcp.example.com/notion" },
		{ id: "mcp-2", name: "Linear", url: "https://mcp.example.com/linear" },
	] as { id: string; name: string; url: string }[],
	skills: [] as { id: string; name: string; description: string }[],
}));

vi.mock("@/utils/orpc", () => ({
	orpc: {
		bridge: {
			listTokens: { key: () => ["bridge", "listTokens"] },
			restartSession: { call: vi.fn().mockResolvedValue({ ok: true }) },
			updateTokenConfig: {
				mutationOptions: (opts: Record<string, unknown>) => ({
					mutationFn: (args: Record<string, unknown>) => {
						store.saveArgs.push(args);
						return Promise.resolve({ ok: true });
					},
					...opts,
				}),
			},
		},
		mcp: {
			listServers: {
				queryOptions: () => ({
					queryKey: ["mcp", "listServers"],
					queryFn: () => Promise.resolve(store.mcpServers),
				}),
			},
		},
		skills: {
			list: {
				queryOptions: () => ({
					queryKey: ["skills", "list"],
					queryFn: () => Promise.resolve(store.skills),
				}),
			},
		},
	},
}));

afterEach(cleanup);
beforeEach(() => {
	store.saveArgs.length = 0;
});

function makeToken(overrides: Partial<BridgeTokenRow> = {}): BridgeTokenRow {
	return {
		id: "token-1",
		userId: "user-1",
		name: "alpha",
		agentKind: "claude-code",
		token: "bt_alpha",
		last4: "1234",
		config: null,
		createdAt: new Date("2026-07-04T12:00:00Z"),
		revokedAt: null,
		...overrides,
	};
}

function renderDialog(token: BridgeTokenRow, sessionId?: string) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const { baseElement } = render(
		<QueryClientProvider client={queryClient}>
			<LocalAgentSettingsDialog
				onOpenChange={() => undefined}
				open
				sessionId={sessionId}
				token={token}
			/>
		</QueryClientProvider>
	);
	// The dialog renders in a portal, so query from the document body.
	return within(baseElement);
}

it("shows the assigned-MCP-servers picker and flows a pick into the saved payload (R5-a)", async () => {
	const view = renderDialog(makeToken());
	fireEvent.click(view.getByRole("tab", { name: "Config" }));

	const notion = await waitFor(() =>
		view.getByRole("checkbox", { name: NOTION_CHECKBOX_RE })
	);
	fireEvent.click(notion);
	fireEvent.click(view.getByRole("button", { name: "Save" }));

	await waitFor(() => {
		expect(store.saveArgs).toHaveLength(1);
	});
	expect(store.saveArgs[0]?.config).toMatchObject({
		mcpServerIds: ["mcp-1"],
	});
});

it("seeds the MCP-servers picker from the token's already-assigned ids", async () => {
	const view = renderDialog(makeToken({ config: { mcpServerIds: ["mcp-2"] } }));
	fireEvent.click(view.getByRole("tab", { name: "Config" }));

	const linear = await waitFor(() =>
		view.getByRole("checkbox", { name: LINEAR_CHECKBOX_RE })
	);
	expect(linear.getAttribute("aria-checked")).toBe("true");
});
