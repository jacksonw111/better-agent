// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SkillCardList } from "./skill-card-list";
import type { SkillRow } from "./skill-types";

function makeSkill(overrides: Partial<SkillRow> = {}): SkillRow {
	return {
		id: "skill-1",
		userId: "user-1",
		isBuiltin: false,
		name: "release checklist",
		description: "steps to cut a release",
		instructions: null,
		allowedTools: null,
		mcpServerIds: null,
		createdAt: new Date("2026-07-04T12:00:00Z"),
		updatedAt: new Date("2026-07-04T12:00:00Z"),
		...overrides,
	};
}

function renderList(
	onEdit: (skill: SkillRow) => void,
	onDelete: (id: string) => void,
	skills = [makeSkill()]
) {
	const { container } = render(
		<SkillCardList onDelete={onDelete} onEdit={onEdit} skills={skills} />
	);
	return {
		body: within(container.ownerDocument.body),
		list: within(container),
	};
}

afterEach(() => {
	cleanup();
});

it("renders a card per skill with its name and description", () => {
	const { list } = renderList(
		() => {
			// no-op
		},
		() => {
			// no-op
		}
	);

	expect(list.getByText("release checklist")).toBeDefined();
	expect(list.getByText("steps to cut a release")).toBeDefined();
});

it("fires onEdit when the name is clicked", () => {
	const onEdit = vi.fn();
	const { list } = renderList(onEdit, () => {
		// no-op
	});

	fireEvent.click(list.getByText("release checklist"));
	expect(onEdit).toHaveBeenCalledWith(
		expect.objectContaining({ id: "skill-1" })
	);
});

it("deletes from the card footer after confirming", () => {
	const onDelete = vi.fn();
	const { body, list } = renderList(() => {
		// no-op
	}, onDelete);

	fireEvent.click(list.getByRole("button", { name: "Delete" }));
	fireEvent.click(body.getByRole("button", { name: "Confirm" }));

	expect(onDelete).toHaveBeenCalledWith("skill-1");
});

it("shows an empty state when there are no rows", () => {
	const { list } = renderList(() => {
		// no-op
	}, () => {
		// no-op
	}, []);

	expect(list.getByText("No skills yet")).toBeDefined();
});
