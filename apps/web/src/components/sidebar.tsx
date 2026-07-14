import type { NavSection } from "@better-agent/ui/components/app-shell-sidebar";
import { AppShellSidebar } from "@better-agent/ui/components/app-shell-sidebar";
import { Bot } from "lucide-react";

import { WEB_NAV_ITEMS } from "@/components/nav-items";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/user-menu";

// Chat is not a top-level nav item — you open a chat from an agent (its row's
// chat action → /chat?agentId=…). Keep Agents highlighted while a chat is open
// (the `match: ["/chat"]` on the Agents entry in nav-items.ts). Local agents
// are a separate destination (P0 route split): /local's prefix match also
// covers /local/$tokenId and the legacy /local-agents redirects. The items
// themselves live in nav-items.ts, shared with the ⌘K palette's "Go to" group.
const SECTIONS: readonly NavSection[] = WEB_NAV_ITEMS.map((item) => ({
	kind: "item",
	item,
}));

export function WebSidebar() {
	return (
		<AppShellSidebar
			brand={{ icon: Bot, title: "better-agent" }}
			footer={
				<div className="flex items-center gap-1">
					<UserMenu />
					<ThemeToggle />
				</div>
			}
			highlightLayoutId="web-sidebar-active"
			sections={SECTIONS}
			variant="sidebar"
		/>
	);
}
