import { createFileRoute } from "@tanstack/react-router";

import { CreateSkillDialog } from "@/components/skills/create-skill-dialog";
import { SkillList } from "@/components/skills/skill-list";

export const Route = createFileRoute("/skills/")({
	component: SkillsPage,
});

function SkillsPage() {
	return (
		<div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-4 p-4 sm:p-6">
			<div className="flex items-center justify-end">
				<CreateSkillDialog />
			</div>
			<SkillList />
		</div>
	);
}
