import { createFileRoute } from "@tanstack/react-router";
import { PageContainer } from "@/components/layout/page-container";
import { TaskList } from "@/components/tasks/task-list";

export const Route = createFileRoute("/tasks/")({
	component: TasksPage,
	validateSearch: (search: Record<string, unknown>): { new?: boolean } => ({
		new:
			search.new === true || search.new === "1" || search.new === 1
				? true
				: undefined,
	}),
});

// ?new=1 deep-links straight into the New Task modal (the retired /tasks/new
// URL redirects here with it). Closing the modal drops the param again so a
// refresh or a shared URL of the plain list doesn't reopen it.
function TasksPage() {
	const { new: openNewTask } = Route.useSearch();
	const navigate = Route.useNavigate();
	return (
		<PageContainer>
			<TaskList
				initialNewTaskOpen={openNewTask === true}
				onNewTaskOpenChange={(open) => {
					if (!open && openNewTask) {
						navigate({ replace: true, search: {} });
					}
				}}
			/>
		</PageContainer>
	);
}
