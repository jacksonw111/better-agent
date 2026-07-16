import { isActivePath } from "@better-agent/ui/components/app-shell-nav";
import { useSidebar } from "@better-agent/ui/components/sidebar";
import { cn } from "@better-agent/ui/lib/utils";
import { Link, useRouterState } from "@tanstack/react-router";
import { BookMarked, Bot, EllipsisIcon, Gauge, ListTodo } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { useEffect, useRef, useState } from "react";
import { useImmersiveChat } from "@/components/layout/use-immersive-chat";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

interface TabItem {
	icon: IconComponent;
	label: string;
	match?: readonly string[];
	to: string;
}

// A deliberate subset of the sidebar's full nav — the destinations worth a
// thumb-reachable slot, plus "More" for everything else (Skills,
// Integrations, theme, account) via the existing hamburger drawer.
const TAB_ITEMS: readonly TabItem[] = [
	// `to` prefix-matching covers /tasks/$taskId and /tasks/new, so no extra
	// `match` needed. S3-T3: Tasks replaced the retired Local tab.
	{ to: "/tasks", label: "Tasks", icon: ListTodo },
	{ to: "/dashboard", label: "Dashboard", icon: Gauge },
	{
		to: "/agents",
		label: "Agents",
		icon: Bot,
		match: ["/chat"],
	},
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
// After the dock flips, showing/hiding it reflows the page (the content's
// reserved bottom padding animates, and a follow-bottom chat scroller re-pins),
// which itself emits scroll events in the OPPOSITE direction. Ignore scroll for
// a beat afterward — longer than the 300ms padding transition — so that
// self-induced reflow can't flip the dock straight back. Without this, scrolling
// near the bottom oscillates forever.
const FLIP_COOLDOWN_MS = 450;

/** Hide the floating dock while scrolling down (reading), reveal it while
 * scrolling up (navigating). Listens in the capture phase on document so it
 * works regardless of which nested container actually scrolls — the page
 * shell, a chat message list, the terminal feed, etc. Only the dock's own
 * transform reacts to this — the content padding stays constant, so the dock
 * hiding can never reflow the page and feed a scroll event back into itself. */
function useHideOnScrollDown(): boolean {
	const [hidden, setHidden] = useState(false);
	const hiddenRef = useRef(false);
	const lastY = useRef(0);
	const lastTarget = useRef<EventTarget | null>(null);
	const cooldownUntil = useRef(0);
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
			const now = performance.now();
			// Within the post-flip cooldown, keep the anchor moving with the reflow
			// but never decide a new direction — this absorbs the opposite-direction
			// scroll the flip itself caused.
			if (now < cooldownUntil.current) {
				lastY.current = y;
				return;
			}
			const delta = y - lastY.current;
			if (Math.abs(delta) < SCROLL_DELTA_THRESHOLD) {
				return;
			}
			lastY.current = y;
			const next = y > 0 && delta > 0;
			if (next !== hiddenRef.current) {
				hiddenRef.current = next;
				cooldownUntil.current = now + FLIP_COOLDOWN_MS;
				setHidden(next);
			}
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

/** The <md app-style floating dock: Tasks/Dashboard/Agents/Memories plus
 * a "More" tab that opens the existing hamburger drawer (Skills, Integrations,
 * theme, account). Mounted once in the authed shell; content needs matching
 * bottom padding (`pb-tab-bar`) so it doesn't sit underneath. Floats as a
 * rounded pill above the content and slides away on scroll-down.
 *
 * Suppressed entirely on an open conversation (<md) — see `useImmersiveChat`:
 * an open chat is an immersive screen navigated via its header's close button.
 * This is a static per-route decision, NOT scroll-driven, so it can't oscillate. */
export function MobileTabBar() {
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	const immersive = useImmersiveChat();
	const hidden = useHideOnScrollDown();
	if (immersive) {
		return null;
	}
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
