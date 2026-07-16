import { createFileRoute } from "@tanstack/react-router";
import { NewTaskWizard } from "@/components/tasks/new-task-wizard";

export const Route = createFileRoute("/tasks/new")({
	component: NewTaskPage,
});

// A narrower column than PageContainer's default: the wizard is a single
// focused flow, not a list. A direct URL visit always begins at Step 1 —
// the draft lives in component state on purpose (spec §8.1).
function NewTaskPage() {
	return (
		<div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 sm:p-6">
			<NewTaskWizard />
		</div>
	);
}
