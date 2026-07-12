import { createFileRoute } from "@tanstack/react-router";

import { LocalAgentList } from "@/components/bridge/local-agent-list";
import { PageContainer } from "@/components/layout/page-container";

export const Route = createFileRoute("/local-agents/")({
	component: LocalAgentsPage,
});

function LocalAgentsPage() {
	return (
		<PageContainer>
			<LocalAgentList />
		</PageContainer>
	);
}
