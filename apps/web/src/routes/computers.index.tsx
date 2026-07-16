import { createFileRoute } from "@tanstack/react-router";
import { ComputerList } from "@/components/computers/computer-list";
import { PageContainer } from "@/components/layout/page-container";

export const Route = createFileRoute("/computers/")({
	component: ComputersPage,
});

function ComputersPage() {
	return (
		<PageContainer>
			<ComputerList />
		</PageContainer>
	);
}
