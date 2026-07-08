import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronRightIcon } from "lucide-react";

export interface BreadcrumbItem {
	label: string;
	/** Undefined on the current (last) crumb — rendered as text, not a link. */
	to?: string;
}

/** A path-based breadcrumb trail. Splits the current pathname into segments
 * and labels each via `labels` (keyed by segment, e.g. `"local-agents"` →
 * `"Local Agents"`). A segment not in the map (a dynamic id like a session or
 * user id) is shown truncated. The last segment is the current page (text, no
 * link); each parent links to its accumulated path so a click jumps up the
 * hierarchy. Renders nothing on the root path.
 *
 * Path-based (not `useMatches`) on purpose: the apps' detail routes
 * (`local-agents.$tokenId`, `customers.$userId`, …) are siblings of their
 * index routes, not children, so the matched-route chain doesn't expose the
 * "Local Agents" parent of a session page. Splitting the URL does. */
export function Breadcrumbs({ labels }: { labels: Record<string, string> }) {
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	const segments = pathname.split("/").filter(Boolean);
	if (segments.length === 0) {
		return null;
	}
	const crumbs: BreadcrumbItem[] = [];
	let acc = "";
	for (let index = 0; index < segments.length; index += 1) {
		const segment = segments[index];
		if (segment === undefined) {
			continue;
		}
		acc += `/${segment}`;
		const isLast = index === segments.length - 1;
		const label = labels[segment] ?? segment.slice(0, 8);
		crumbs.push({ label, to: isLast ? undefined : acc });
	}
	return (
		<nav
			aria-label="Breadcrumb"
			className="flex min-w-0 items-center gap-1 text-sm"
		>
			{crumbs.map((crumb, index) => (
				<span
					className="flex min-w-0 items-center gap-1"
					key={crumb.to ?? crumb.label}
				>
					{index > 0 ? (
						<ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
					) : null}
					{crumb.to ? (
						<Link
							className="truncate text-muted-foreground hover:text-foreground"
							to={crumb.to as never}
						>
							{crumb.label}
						</Link>
					) : (
						<span className="truncate font-medium">{crumb.label}</span>
					)}
				</span>
			))}
		</nav>
	);
}
