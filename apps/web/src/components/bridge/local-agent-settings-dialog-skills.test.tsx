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

// R5-T2: the skills-assignment field's own coverage, split out of
// local-agent-settings-dialog.test.tsx purely to keep that file under the
// repo's 300-line limit (same split as bridge-skills-resolve.test.ts on the
// server side). Duplicates the shared mock harness since vi.mock is scoped
// per test file.

vi.mock("sonner", () => ({
	toast: { error: vi.fn(), success: vi.fn() },
}));

// McpServersField (rendered unconditionally alongside the skills picker on
// the Config tab) renders a <Link> to /integrations in its empty state —
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

const RESEARCH_SKILL_RE = /Research helper/;
const TRIAGE_SKILL_RE = /Triage helper/;

const store = vi.hoisted(() => ({
	saveArgs: [] as Record<string, unknown>[],
	skills: [
		{ id: "skill-1", name: "Research helper", description: "Digs stuff up" },
		{ id: "skill-2", name: "Triage helper", description: "Sorts stuff" },
	] as { id: string; name: string; description: string }[],
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
					queryFn: () => Promise.resolve([]),
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

it("shows the assigned-skills picker and flows a pick into the saved payload (R5-T2)", async () => {
	const view = renderDialog(makeToken());
	fireEvent.click(view.getByRole("tab", { name: "Config" }));

	const research = await waitFor(() =>
		view.getByRole("checkbox", { name: RESEARCH_SKILL_RE })
	);
	fireEvent.click(research);
	fireEvent.click(view.getByRole("button", { name: "Save" }));

	await waitFor(() => {
		expect(store.saveArgs).toHaveLength(1);
	});
	expect(store.saveArgs[0]?.config).toMatchObject({
		skillIds: ["skill-1"],
	});
});

it("seeds the skills picker from the token's already-assigned ids", async () => {
	const view = renderDialog(makeToken({ config: { skillIds: ["skill-2"] } }));
	fireEvent.click(view.getByRole("tab", { name: "Config" }));

	const triage = await waitFor(() =>
		view.getByRole("checkbox", { name: TRIAGE_SKILL_RE })
	);
	expect(triage.getAttribute("aria-checked")).toBe("true");
});

it("shows the restart hint when only skillIds changed (skills only apply at session start)", async () => {
	const { toast } = await import("sonner");
	const view = renderDialog(makeToken(), "session-1");
	fireEvent.click(view.getByRole("tab", { name: "Config" }));

	const research = await waitFor(() =>
		view.getByRole("checkbox", { name: RESEARCH_SKILL_RE })
	);
	fireEvent.click(research);
	fireEvent.click(view.getByRole("button", { name: "Save" }));

	await waitFor(() => {
		expect(store.saveArgs).toHaveLength(1);
	});
	expect(toast.success).toHaveBeenCalledWith(
		"Saved — restart the agent to apply",
		expect.objectContaining({
			action: expect.objectContaining({ label: "Restart now" }),
		})
	);
});
