import { createFileRoute } from "@tanstack/react-router";

import { UnifiedAgentList } from "@/components/agents/unified-agent-list";
import { PageContainer } from "@/components/layout/page-container";

export const Route = createFileRoute("/agents/")({
	component: AgentsPage,
});

function AgentsPage() {
	return (
		<PageContainer>
			<UnifiedAgentList />
		</PageContainer>
	);
}
