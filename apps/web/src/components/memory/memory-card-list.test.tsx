// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryCardList } from "./memory-card-list";
import type { MemoryRow } from "./memory-types";

const store = vi.hoisted(() => ({
	navigatedTo: [] as Record<string, unknown>[],
}));

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => (opts: Record<string, unknown>) => {
		store.navigatedTo.push(opts);
	},
}));

function makeMemory(overrides: Partial<MemoryRow> = {}): MemoryRow {
	return {
		id: "memory-1",
		userId: "user-1",
		name: "runbooks",
		description: "ops runbooks",
		createdAt: new Date("2026-07-04T12:00:00Z"),
		updatedAt: new Date("2026-07-04T12:00:00Z"),
		...overrides,
	};
}

function renderList(onDelete: (id: string) => void, memories = [makeMemory()]) {
	const { container } = render(
		<MemoryCardList memories={memories} onDelete={onDelete} />
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

it("renders a card per memory with its name and description", () => {
	const { list } = renderList(() => {
		// no-op
	});

	expect(list.getByText("runbooks")).toBeDefined();
	expect(list.getByText("ops runbooks")).toBeDefined();
});

it("navigates to the memory detail when the name is clicked", () => {
	const { list } = renderList(() => {
		// no-op
	});

	fireEvent.click(list.getByText("runbooks"));
	expect(store.navigatedTo[0]).toMatchObject({
		to: "/memories/$memoryId",
		params: { memoryId: "memory-1" },
	});
});

it("deletes from the card footer after confirming, without navigating", () => {
	const onDelete = vi.fn();
	const { body, list } = renderList(onDelete);

	fireEvent.click(list.getByRole("button", { name: "Delete" }));
	fireEvent.click(body.getByRole("button", { name: "Confirm" }));

	expect(onDelete).toHaveBeenCalledWith("memory-1");
	expect(store.navigatedTo).toHaveLength(0);
});

it("shows an empty state when there are no rows", () => {
	const { list } = renderList(() => {
		// no-op
	}, []);

	expect(list.getByText("No memories yet")).toBeDefined();
});

it("falls back to '—' for a missing description, matching MemoryTable's fallback", () => {
	const { list } = renderList(() => {
		// no-op
	}, [makeMemory({ description: null })]);

	expect(list.getByText("—")).toBeDefined();
});
