// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { BridgeTokenRow } from "@/utils/api-types";
import type { LocalAgentEntry } from "./local-agent-join";
import { LocalAgentTable, type LocalAgentTableRow } from "./local-agent-table";

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

function renderTable(onDelete: (id: string) => void) {
	const { container } = render(
		<LocalAgentTable onDelete={onDelete} rows={[makeRow()]} />
	);
	return {
		body: within(container.ownerDocument.body),
		row: within(container),
	};
}

afterEach(() => {
	store.navigatedTo.length = 0;
	cleanup();
});

it("renders a row per token with its kind, status and session count", () => {
	const { row } = renderTable(() => {
		// no-op
	});

	expect(row.getByText("alpha agent")).toBeDefined();
	expect(row.getByText("Claude Code")).toBeDefined();
	expect(row.getByText("Live")).toBeDefined();
	expect(row.getByText("2")).toBeDefined();
});

it("navigates to the agent detail when the name is clicked", () => {
	const { row } = renderTable(() => {
		// no-op
	});

	fireEvent.click(row.getByText("alpha agent"));
	expect(store.navigatedTo[0]).toMatchObject({
		to: "/local-agents/$tokenId",
		params: { tokenId: "token-1" },
	});
});

it("does not navigate when clicking outside the name (e.g. the token cell)", () => {
	const { row } = renderTable(() => {
		// no-op
	});

	// Only the name navigates — the rest of the row must stay plain so the
	// token (and other cells) can be selected/copied without jumping away.
	fireEvent.click(row.getByTitle("Show token & run command"));
	expect(store.navigatedTo).toHaveLength(0);
});

it("deletes from the Actions cell after confirming, without navigating", () => {
	const onDelete = vi.fn();
	const { body, row } = renderTable(onDelete);

	fireEvent.click(row.getByRole("button", { name: "Delete" }));
	fireEvent.click(body.getByRole("button", { name: "Confirm" }));

	expect(onDelete).toHaveBeenCalledWith("token-1");
	expect(store.navigatedTo).toHaveLength(0);
});
