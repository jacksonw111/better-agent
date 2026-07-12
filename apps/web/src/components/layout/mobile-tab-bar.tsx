import { isActivePath } from "@better-agent/ui/components/app-shell-nav";
import { useSidebar } from "@better-agent/ui/components/sidebar";
import { cn } from "@better-agent/ui/lib/utils";
import { Link, useRouterState } from "@tanstack/react-router";
import {
	BookMarked,
	Bot,
	EllipsisIcon,
	Gauge,
	TerminalSquare,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

interface TabItem {
	icon: IconComponent;
	label: string;
	match?: readonly string[];
	to: string;
}

// A deliberate subset of the sidebar's full nav — the 4 destinations worth a
// thumb-reachable slot, plus "More" for everything else (Skills,
// Integrations, theme, account) via the existing hamburger drawer.
const TAB_ITEMS: readonly TabItem[] = [
	{ to: "/dashboard", label: "Dashboard", icon: Gauge },
	{ to: "/agents", label: "Agents", icon: Bot, match: ["/chat"] },
	{ to: "/local-agents", label: "Local Agent", icon: TerminalSquare },
	{ to: "/memories", label: "Memories", icon: BookMarked },
];

function TabLink({ item, active }: { item: TabItem; active: boolean }) {
	const Icon = item.icon;
	return (
		<Link
			aria-current={active ? "page" : undefined}
			className={cn(
				"flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-xs",
				active ? "text-primary" : "text-muted-foreground"
			)}
			to={item.to}
		>
			<Icon className="size-5" />
			{item.label}
		</Link>
	);
}

function MoreTabButton() {
	const { setOpenMobile } = useSidebar();
	return (
		<button
			className="flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-muted-foreground text-xs"
			onClick={() => setOpenMobile(true)}
			type="button"
		>
			<EllipsisIcon className="size-5" />
			More
		</button>
	);
}

/** The <md app-style bottom tab bar: Dashboard/Agents/Local Agent/Memories
 * plus a "More" tab that opens the existing hamburger drawer (Skills,
 * Integrations, theme, account). Mounted once in the authed shell; content
 * needs matching bottom padding (`pb-tab-bar`) so it doesn't sit underneath. */
export function MobileTabBar() {
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	return (
		<nav
			aria-label="Primary"
			className="fixed inset-x-0 bottom-0 z-40 flex border-t bg-background/90 pb-safe-bottom backdrop-blur md:hidden"
		>
			{TAB_ITEMS.map((item) => (
				<TabLink
					active={isActivePath(pathname, item.to, item.match)}
					item={item}
					key={item.to}
				/>
			))}
			<MoreTabButton />
		</nav>
	);
}
