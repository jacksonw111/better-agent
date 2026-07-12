import { createFileRoute } from "@tanstack/react-router";

import { PageContainer } from "@/components/layout/page-container";
import { MemoryList } from "@/components/memory/memory-list";

export const Route = createFileRoute("/memories/")({
	component: MemoriesPage,
});

function MemoriesPage() {
	return (
		<PageContainer>
			<MemoryList />
		</PageContainer>
	);
}
