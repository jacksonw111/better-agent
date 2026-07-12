// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { BridgeTokenRow } from "@/utils/api-types";
import { capabilities } from "./agent-capabilities";
import { TerminalHeaderOverflowMenu } from "./terminal-header-overflow-menu";

// The Settings dialog (LocalAgentSettingsDialog) pulls in react-query
// mutations — mocked the same minimal way local-agent-settings-dialog.test.tsx
// does, just enough for it to mount without hitting the network.
vi.mock("@/utils/orpc", () => ({
	orpc: {
		bridge: {
			listTokens: { key: () => ["bridge", "listTokens"] },
			updateTokenConfig: {
				mutationOptions: (opts: Record<string, unknown>) => ({
					mutationFn: () => Promise.resolve({ ok: true }),
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
					queryFn: () => Promise.resolve([]),
				}),
			},
		},
	},
}));

vi.mock("sonner", () => ({
	toast: { error: vi.fn(), success: vi.fn() },
}));

afterEach(cleanup);

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

// A live (non-ended) session with claude-code's real capability matrix, so
// the menu has something in every gated slot (Past conversations, Status,
// Restart, End) to assert on. Wrapped in a QueryClientProvider so the
// Settings dialog (only mounted once `token` is passed and Settings is
// clicked) has react-query available.
function renderMenu(token?: BridgeTokenRow) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const { baseElement } = render(
		<QueryClientProvider client={queryClient}>
			<TerminalHeaderOverflowMenu
				canSend
				caps={capabilities("claude-code")}
				ending={false}
				getStatus={() => Promise.resolve()}
				listSessions={() => undefined}
				onEnd={() => undefined}
				restart={() => Promise.resolve()}
				sessionList={null}
				status="live"
				statusSnapshot={null}
				token={token}
				usageUpdate={null}
			/>
		</QueryClientProvider>
	);
	return within(baseElement);
}

it("stays collapsed behind a single trigger until opened", () => {
	const view = renderMenu();

	expect(view.getByRole("button", { name: "More actions" })).toBeDefined();
	expect(view.queryByRole("button", { name: "Past conversations" })).toBeNull();
	expect(
		view.queryByRole("button", { name: "End local agent session" })
	).toBeNull();
});

it("reveals Past conversations, Status, Restart and End once opened", () => {
	const view = renderMenu();

	fireEvent.click(view.getByRole("button", { name: "More actions" }));

	expect(
		view.getByRole("button", { name: "Past conversations" })
	).toBeDefined();
	expect(view.getByRole("button", { name: "Status" })).toBeDefined();
	expect(
		view.getByRole("button", { name: "Restart local agent session" })
	).toBeDefined();
	expect(
		view.getByRole("button", { name: "End local agent session" })
	).toBeDefined();
});

it("hides Restart and End once the session has ended", () => {
	const { baseElement } = render(
		<TerminalHeaderOverflowMenu
			canSend={false}
			caps={capabilities("claude-code")}
			ending={false}
			getStatus={() => Promise.resolve()}
			listSessions={() => undefined}
			onEnd={() => undefined}
			restart={() => Promise.resolve()}
			sessionList={null}
			status="ended"
			statusSnapshot={null}
			usageUpdate={null}
		/>
	);
	const view = within(baseElement);
	fireEvent.click(view.getByRole("button", { name: "More actions" }));

	expect(
		view.queryByRole("button", { name: "Restart local agent session" })
	).toBeNull();
	expect(
		view.queryByRole("button", { name: "End local agent session" })
	).toBeNull();
});

it("opens the Settings dialog from the overflow menu", async () => {
	const view = renderMenu(makeToken());

	fireEvent.click(view.getByRole("button", { name: "More actions" }));
	fireEvent.click(view.getByRole("button", { name: "Settings" }));

	expect(await view.findByRole("tab", { name: "General" })).toBeDefined();
});

it("keeps the Settings dialog mounted after the overflow menu itself unmounts (mobile flash bug)", async () => {
	// DropdownMenuContent (Base UI's Menu.Popup) fully unmounts once the menu
	// closes — before this fix, the Settings dialog's open-state lived inside
	// that content (via SessionControls' own useState), so closing the menu
	// (which Base UI can do on its own, e.g. once focus moves into the
	// dialog's modal) unmounted the dialog right along with it, giving mobile
	// users a flash-and-close. Toggling the trigger here forces that same
	// content-unmount deterministically, without depending on real-browser
	// focus/blur timing that jsdom can't reproduce.
	const view = renderMenu(makeToken());

	fireEvent.click(view.getByRole("button", { name: "More actions" }));
	fireEvent.click(view.getByRole("button", { name: "Settings" }));
	await view.findByRole("tab", { name: "General" });

	// Force-close the overflow menu while the dialog is open. The trigger is
	// marked inert/aria-hidden by now (the dialog's modal makes the rest of
	// the page inert) — `hidden: true` reaches it anyway, standing in for
	// whatever real mechanism (focus loss, escape, an outside interaction)
	// Base UI uses to close the menu once the modal is up.
	fireEvent.click(
		view.getByRole("button", { hidden: true, name: "More actions" })
	);

	expect(view.getByRole("tab", { name: "General" })).toBeDefined();
});
