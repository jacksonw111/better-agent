import { expect, it } from "vitest";
import { WEB_NAV_ITEMS } from "./nav-items";

// Nav per the computer-detail-tasks slice: Tasks left the top nav entirely —
// a computer's tasks live on its detail page, and /tasks survives only as a
// route (detail-page links and deep links). Both the sidebar and the ⌘K
// "Go to" group render from this list, so pinning the order here covers both.
it("orders the nav Dashboard-first with Computers second and no Tasks entry", () => {
	expect(WEB_NAV_ITEMS.map((item) => item.label)).toEqual([
		"Dashboard",
		"Computers",
		"Agents",
		"Memories",
		"Knowledge",
		"Skills",
		"Integrations",
	]);
});

it("keeps every destination off the retired /local and de-navved /tasks routes", () => {
	for (const item of WEB_NAV_ITEMS) {
		expect(item.to).not.toBe("/local");
		expect(item.to).not.toBe("/tasks");
	}
});
