import { expect, it } from "vitest";
import { WEB_NAV_ITEMS } from "./nav-items";

// Both the sidebar and the ⌘K "Go to" group render from this list, so pinning
// the order here covers both.
it("orders the nav Dashboard-first with no local-agent entries", () => {
	expect(WEB_NAV_ITEMS.map((item) => item.label)).toEqual([
		"Dashboard",
		"Agents",
		"Memories",
		"Knowledge",
		"Skills",
		"Integrations",
	]);
});
