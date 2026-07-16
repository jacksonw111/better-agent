import { expect, it } from "vitest";
import { WEB_NAV_ITEMS } from "./nav-items";

// S3-T3 nav定案: Tasks leads, Computers second, and the retired Local Agents
// entry is gone. Both the sidebar and the ⌘K "Go to" group render from this
// list, so pinning the order here covers them both.
it("orders the nav Tasks-first with Computers second and no Local Agents", () => {
	expect(WEB_NAV_ITEMS.map((item) => item.label)).toEqual([
		"Tasks",
		"Computers",
		"Dashboard",
		"Agents",
		"Memories",
		"Knowledge",
		"Skills",
		"Integrations",
	]);
});

it("keeps every destination off the retired /local list route", () => {
	for (const item of WEB_NAV_ITEMS) {
		expect(item.to).not.toBe("/local");
	}
});
