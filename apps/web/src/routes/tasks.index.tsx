import { createFileRoute } from "@tanstack/react-router";
import { PageContainer } from "@/components/layout/page-container";
import { TaskList } from "@/components/tasks/task-list";

export const Route = createFileRoute("/tasks/")({
	component: TasksPage,
});

function TasksPage() {
	return (
		<PageContainer>
			<TaskList />
		</PageContainer>
	);
}
