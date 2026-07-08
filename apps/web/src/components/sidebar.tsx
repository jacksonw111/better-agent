import type { NavSection } from "@better-agent/ui/components/app-shell-sidebar";
import { AppShellSidebar } from "@better-agent/ui/components/app-shell-sidebar";
import { BookMarked, Bot, Gauge, Plug, TerminalSquare } from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/user-menu";

// Chat is not a top-level nav item — you open a chat from an agent (its row's
// chat action → /chat?agentId=…). Keep Agents highlighted while a chat is open.
const SECTIONS: readonly NavSection[] = [
	{
		kind: "item",
		item: { to: "/dashboard", label: "Dashboard", icon: Gauge },
	},
	{
		kind: "item",
		item: { to: "/agents", label: "Agents", icon: Bot, match: ["/chat"] },
	},
	{
		kind: "item",
		item: { to: "/memories", label: "Memories", icon: BookMarked },
	},
	{
		kind: "item",
		item: { to: "/integrations", label: "Integrations", icon: Plug },
	},
	{
		kind: "item",
		item: { to: "/local-agents", label: "Local Agent", icon: TerminalSquare },
	},
];

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
