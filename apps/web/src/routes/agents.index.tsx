import { createFileRoute } from "@tanstack/react-router";

import { AgentsCard } from "@/components/agents/agents-card";
import { PageContainer } from "@/components/layout/page-container";

export const Route = createFileRoute("/agents/")({
	component: AgentsPage,
});

function AgentsPage() {
	return (
		<PageContainer>
			<AgentsCard />
		</PageContainer>
	);
}
