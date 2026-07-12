import { createFileRoute } from "@tanstack/react-router";

import { PageContainer } from "@/components/layout/page-container";
import { SkillList } from "@/components/skills/skill-list";

export const Route = createFileRoute("/skills/")({
	component: SkillsPage,
});

function SkillsPage() {
	return (
		<PageContainer>
			<SkillList />
		</PageContainer>
	);
}
