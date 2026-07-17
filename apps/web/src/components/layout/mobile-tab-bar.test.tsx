// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { MobileTabBar } from "./mobile-tab-bar";

const DASHBOARD_LABEL_PATTERN = /Dashboard/;
const AGENTS_LABEL_PATTERN = /^Agents/;
const COMPUTERS_LABEL_PATTERN = /Computers/;
const TASKS_LABEL_PATTERN = /Tasks/;
const MEMORIES_LABEL_PATTERN = /Memories/;
const MORE_LABEL_PATTERN = /More/;

const store = vi.hoisted(() => ({
	pathname: "/dashboard",
	search: {} as Record<string, unknown>,
	setOpenMobileCalls: [] as boolean[],
}));

vi.mock("@tanstack/react-router", () => ({
	useRouterState: (opts: { select: (state: unknown) => unknown }) =>
		opts.select({
			location: { pathname: store.pathname, search: store.search },
		}),
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
	store.search = {};
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
		view.getByRole("link", { name: COMPUTERS_LABEL_PATTERN })
	).toBeDefined();
	// Tasks left the dock along with the top nav — Computers took its slot.
	expect(view.queryByRole("link", { name: TASKS_LABEL_PATTERN })).toBeNull();
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

it("activates the Computers tab on the list and a computer's detail alike", () => {
	store.pathname = "/computers";
	let view = renderBar();
	expect(
		view.getByRole("link", { name: COMPUTERS_LABEL_PATTERN }).className
	).toContain("text-primary");
	expect(
		view.getByRole("link", { name: AGENTS_LABEL_PATTERN }).className
	).not.toContain("text-primary");

	cleanup();
	store.pathname = "/computers/computer-1";
	view = renderBar();
	// /computers/$computerId shares the /computers prefix, so the tab stays
	// lit on the detail page.
	expect(
		view.getByRole("link", { name: COMPUTERS_LABEL_PATTERN }).className
	).toContain("text-primary");
});

it("opens the sidebar drawer when More is tapped", () => {
	const view = renderBar();

	fireEvent.click(view.getByRole("button", { name: MORE_LABEL_PATTERN }));
	expect(store.setOpenMobileCalls).toEqual([true]);
});

it("renders the dock on /agents", () => {
	store.pathname = "/agents";
	const view = renderBar();

	expect(view.getByRole("navigation", { name: "Primary" })).toBeDefined();
});

it("keeps the dock on the bare /chat agent-picker grid", () => {
	store.pathname = "/chat";
	const view = renderBar();

	expect(view.getByRole("navigation", { name: "Primary" })).toBeDefined();
});

it("suppresses the dock when /chat has a selected cloud agent", () => {
	store.pathname = "/chat";
	store.search = { agentId: "agent-1" };
	const view = renderBar();

	expect(view.queryByRole("navigation")).toBeNull();
});

it("keeps the dock on the /tasks list even though Tasks has no tab", () => {
	store.pathname = "/tasks";
	const view = renderBar();

	expect(view.getByRole("navigation", { name: "Primary" })).toBeDefined();
});

it("suppresses the dock inside a local agent's workspace", () => {
	store.pathname = "/local/token-1";
	const view = renderBar();

	expect(view.queryByRole("navigation")).toBeNull();
});
