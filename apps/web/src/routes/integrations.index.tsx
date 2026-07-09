import { cn } from "@better-agent/ui/lib/utils";
import { createFileRoute, Link } from "@tanstack/react-router";

import { AccountsList } from "@/components/integrations/accounts-list";
import { McpServersSection } from "@/components/integrations/mcp-servers-section";
import { OcAccountsList } from "@/components/integrations/oc-accounts-list";

type SettingsTab = "composio" | "openconnector" | "mcp";

const DEFAULT_TAB: SettingsTab = "composio";

const TABS: ReadonlyArray<{ id: SettingsTab; label: string }> = [
	{ id: "composio", label: "Composio" },
	{ id: "openconnector", label: "OpenConnector" },
	{ id: "mcp", label: "MCP Servers" },
];

function isSettingsTab(value: unknown): value is SettingsTab {
	return value === "composio" || value === "openconnector" || value === "mcp";
}

export const Route = createFileRoute("/integrations/")({
	component: IntegrationsPage,
	validateSearch: (search: Record<string, unknown>): { tab?: SettingsTab } => ({
		tab: isSettingsTab(search.tab) ? search.tab : undefined,
	}),
});

function SettingsTabLink({
	active,
	id,
	label,
}: {
	active: boolean;
	id: SettingsTab;
	label: string;
}) {
	return (
		<Link
			className={cn(
				"rounded-md px-3 py-1.5 text-left text-sm transition-colors",
				active
					? "bg-primary/10 font-medium text-primary"
					: "text-muted-foreground hover:bg-muted hover:text-foreground"
			)}
			search={{ tab: id }}
			to="/integrations"
		>
			{label}
		</Link>
	);
}

function IntegrationsPage() {
	const { tab = DEFAULT_TAB } = Route.useSearch();

	return (
		<div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 overflow-auto p-4 sm:flex-row sm:p-6">
			<nav className="flex shrink-0 flex-row gap-1 sm:w-48 sm:flex-col">
				{TABS.map((t) => (
					<SettingsTabLink active={t.id === tab} key={t.id} {...t} />
				))}
			</nav>
			<div className="min-w-0 flex-1">
				{tab === "composio" && <AccountsList />}
				{tab === "openconnector" && <OcAccountsList />}
				{tab === "mcp" && <McpServersSection />}
			</div>
		</div>
	);
}
