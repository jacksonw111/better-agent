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
import { useEffect, useRef, useState } from "react";

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

// Ignore scroll jitter below this many pixels so the dock doesn't flicker on
// tiny momentum wobbles.
const SCROLL_DELTA_THRESHOLD = 8;

/** Hide the floating dock while scrolling down (reading), reveal it while
 * scrolling up (navigating). Listens in the capture phase on document so it
 * works regardless of which nested container actually scrolls — the page
 * shell, a chat message list, the terminal feed, etc. Exported so the authed
 * shell can drive both the dock transform AND the content's bottom padding from
 * one source — otherwise hiding the dock leaves a dock-height gap under a
 * pinned composer (mobile chat). */
export function useHideOnScrollDown(): boolean {
	const [hidden, setHidden] = useState(false);
	const lastY = useRef(0);
	const lastTarget = useRef<EventTarget | null>(null);
	useEffect(() => {
		const onScroll = (event: Event) => {
			const target = event.target;
			const y = target instanceof Element ? target.scrollTop : window.scrollY;
			// A different scroller took over (route change, opened panel): re-anchor
			// without deciding a direction from an unrelated position.
			if (target !== lastTarget.current) {
				lastTarget.current = target;
				lastY.current = y;
				return;
			}
			const delta = y - lastY.current;
			if (Math.abs(delta) < SCROLL_DELTA_THRESHOLD) {
				return;
			}
			setHidden(y > 0 && delta > 0);
			lastY.current = y;
		};
		document.addEventListener("scroll", onScroll, {
			capture: true,
			passive: true,
		});
		return () =>
			document.removeEventListener("scroll", onScroll, { capture: true });
	}, []);
	return hidden;
}

/** The <md app-style floating dock: Dashboard/Agents/Local Agent/Memories plus
 * a "More" tab that opens the existing hamburger drawer (Skills, Integrations,
 * theme, account). Mounted once in the authed shell; content needs matching
 * bottom padding (`pb-tab-bar`) so it doesn't sit underneath. Floats as a
 * rounded pill above the content and slides away on scroll-down. */
export function MobileTabBar({ hidden }: { hidden: boolean }) {
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	return (
		<div
			className={cn(
				"pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-safe-bottom transition-transform duration-300 ease-out md:hidden",
				hidden && "dock-hidden"
			)}
		>
			<nav
				aria-label="Primary"
				className="pointer-events-auto flex w-full max-w-md items-stretch rounded-2xl border bg-background/80 shadow-lg backdrop-blur-md"
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
		</div>
	);
}
