import { cn } from "@better-agent/ui/lib/utils";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageContainer } from "@/components/layout/page-container";
import { ProfileOverview } from "@/components/profile/profile-overview";
import { StandardsSection } from "@/components/profile/standards-section";
import { TemplatesSection } from "@/components/profile/templates-section";

type ProfileTab = "overview" | "standards" | "templates";

const DEFAULT_TAB: ProfileTab = "overview";

const TABS: ReadonlyArray<{ id: ProfileTab; label: string }> = [
	{ id: "overview", label: "Overview" },
	{ id: "standards", label: "Standards" },
	{ id: "templates", label: "Templates" },
];

function isProfileTab(value: unknown): value is ProfileTab {
	return value === "overview" || value === "standards" || value === "templates";
}

export const Route = createFileRoute("/profile/")({
	component: ProfilePage,
	validateSearch: (search: Record<string, unknown>): { tab?: ProfileTab } => ({
		tab: isProfileTab(search.tab) ? search.tab : undefined,
	}),
});

function ProfileTabLink({
	active,
	id,
	label,
}: {
	active: boolean;
	id: ProfileTab;
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
			to="/profile"
		>
			{label}
		</Link>
	);
}

function ProfilePage() {
	const { tab = DEFAULT_TAB } = Route.useSearch();
	return (
		<PageContainer>
			<div className="flex flex-col gap-6 sm:flex-row">
				<nav className="flex shrink-0 flex-row gap-1 sm:w-48 sm:flex-col">
					{TABS.map((t) => (
						<ProfileTabLink active={t.id === tab} key={t.id} {...t} />
					))}
				</nav>
				<div className="min-w-0 flex-1">
					{tab === "overview" && <ProfileOverview />}
					{tab === "standards" && <StandardsSection />}
					{tab === "templates" && <TemplatesSection />}
				</div>
			</div>
		</PageContainer>
	);
}
