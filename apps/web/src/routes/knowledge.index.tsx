import { createFileRoute } from "@tanstack/react-router";

import { KnowledgeList } from "@/components/knowledge/knowledge-list";
import { PageContainer } from "@/components/layout/page-container";

export const Route = createFileRoute("/knowledge/")({
	component: KnowledgePage,
});

function KnowledgePage() {
	return (
		<PageContainer>
			<KnowledgeList />
		</PageContainer>
	);
}
