// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { MobileTabBar } from "./mobile-tab-bar";

const DASHBOARD_LABEL_PATTERN = /Dashboard/;
const AGENTS_LABEL_PATTERN = /Agents/;
const MEMORIES_LABEL_PATTERN = /Memories/;
const MORE_LABEL_PATTERN = /More/;

const store = vi.hoisted(() => ({
	pathname: "/dashboard",
	setOpenMobileCalls: [] as boolean[],
}));

vi.mock("@tanstack/react-router", () => ({
	useRouterState: (opts: { select: (state: unknown) => unknown }) =>
		opts.select({ location: { pathname: store.pathname } }),
	Link: ({
		children,
		to,
		className,
		...rest
	}: {
		children: ReactNode;
		to: string;
		className?: string;
	} & Record<string, unknown>) => (
		<a className={className} href={to} {...rest}>
			{children}
		</a>
	),
}));

vi.mock("@better-agent/ui/components/sidebar", () => ({
	useSidebar: () => ({
		setOpenMobile: (open: boolean) => {
			store.setOpenMobileCalls.push(open);
		},
	}),
}));

function renderBar() {
	const { container } = render(<MobileTabBar />);
	return within(container);
}

afterEach(() => {
	store.pathname = "/dashboard";
	store.setOpenMobileCalls.length = 0;
	cleanup();
});

it("renders a tab for each primary destination plus More", () => {
	const view = renderBar();

	expect(
		view.getByRole("link", { name: DASHBOARD_LABEL_PATTERN })
	).toBeDefined();
	expect(view.getByRole("link", { name: AGENTS_LABEL_PATTERN })).toBeDefined();
	expect(
		view.getByRole("link", { name: MEMORIES_LABEL_PATTERN })
	).toBeDefined();
	expect(view.getByRole("button", { name: MORE_LABEL_PATTERN })).toBeDefined();
});

it("tints the tab matching the current route as active", () => {
	store.pathname = "/agents";
	const view = renderBar();

	const agentsTab = view.getByRole("link", { name: AGENTS_LABEL_PATTERN });
	const dashboardTab = view.getByRole("link", {
		name: DASHBOARD_LABEL_PATTERN,
	});
	expect(agentsTab.className).toContain("text-primary");
	expect(dashboardTab.className).not.toContain("text-primary");
});

it("treats /chat as part of the Agents tab's active match", () => {
	store.pathname = "/chat";
	const view = renderBar();

	expect(
		view.getByRole("link", { name: AGENTS_LABEL_PATTERN }).className
	).toContain("text-primary");
});

it("treats /local-agents as part of the Agents tab's active match", () => {
	store.pathname = "/local-agents";
	const view = renderBar();

	expect(
		view.getByRole("link", { name: AGENTS_LABEL_PATTERN }).className
	).toContain("text-primary");
});

it("opens the sidebar drawer when More is tapped", () => {
	const view = renderBar();

	fireEvent.click(view.getByRole("button", { name: MORE_LABEL_PATTERN }));
	expect(store.setOpenMobileCalls).toEqual([true]);
});
