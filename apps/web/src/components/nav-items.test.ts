import { expect, it } from "vitest";
import { WEB_NAV_ITEMS } from "./nav-items";

// Nav order per the computer-detail slice: Dashboard leads, Computers second,
// Tasks third; everything else keeps its previous relative order. Both the
// sidebar and the ⌘K "Go to" group render from this list, so pinning the
// order here covers them both.
it("orders the nav Dashboard-first with Computers second and Tasks third", () => {
	expect(WEB_NAV_ITEMS.map((item) => item.label)).toEqual([
		"Dashboard",
		"Computers",
		"Tasks",
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
