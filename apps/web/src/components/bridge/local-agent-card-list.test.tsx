// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { BridgeTokenRow } from "@/utils/api-types";
import { LocalAgentCardList } from "./local-agent-card-list";
import type { LocalAgentEntry } from "./local-agent-join";
import type { LocalAgentTableRow } from "./local-agent-table";

const store = vi.hoisted(() => ({
	navigatedTo: [] as Record<string, unknown>[],
}));

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => (opts: Record<string, unknown>) => {
		store.navigatedTo.push(opts);
	},
}));

function makeToken(overrides: Partial<BridgeTokenRow> = {}): BridgeTokenRow {
	return {
		id: "token-1",
		userId: "user-1",
		name: "alpha agent",
		agentKind: "claude-code",
		token: "bt_alpha",
		last4: "1234",
		config: null,
		createdAt: new Date("2026-07-04T12:00:00Z"),
		revokedAt: null,
		...overrides,
	};
}

function makeRow(overrides: Partial<BridgeTokenRow> = {}): LocalAgentTableRow {
	const entry: LocalAgentEntry = {
		latestSession: null,
		status: "live",
		token: makeToken(overrides),
	};
	return { entry, sessionCount: 2 };
}

function renderList(onDelete: (id: string) => void, rows = [makeRow()]) {
	const { container } = render(
		<LocalAgentCardList onDelete={onDelete} rows={rows} />
	);
	return {
		body: within(container.ownerDocument.body),
		list: within(container),
	};
}

afterEach(() => {
	store.navigatedTo.length = 0;
	cleanup();
});

it("renders a card per row with its kind, status and session count", () => {
	const { list } = renderList(() => {
		// no-op
	});

	expect(list.getByText("alpha agent")).toBeDefined();
	expect(list.getByText("Claude Code")).toBeDefined();
	expect(list.getByText("Live")).toBeDefined();
	expect(list.getByText("2 sessions")).toBeDefined();
});

it("navigates to the agent detail when the name is clicked", () => {
	const { list } = renderList(() => {
		// no-op
	});

	fireEvent.click(list.getByText("alpha agent"));
	expect(store.navigatedTo[0]).toMatchObject({
		to: "/local-agents/$tokenId",
		params: { tokenId: "token-1" },
	});
});

it("deletes from the card footer after confirming, without navigating", () => {
	const onDelete = vi.fn();
	const { body, list } = renderList(onDelete);

	fireEvent.click(list.getByRole("button", { name: "Delete" }));
	fireEvent.click(body.getByRole("button", { name: "Confirm" }));

	expect(onDelete).toHaveBeenCalledWith("token-1");
	expect(store.navigatedTo).toHaveLength(0);
});

it("shows an empty state when there are no rows", () => {
	const { list } = renderList(() => {
		// no-op
	}, []);

	expect(list.getByText("No local agents yet")).toBeDefined();
});
