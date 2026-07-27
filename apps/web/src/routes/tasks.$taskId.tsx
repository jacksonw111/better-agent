import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/tasks/$taskId")({
	component: TaskConversationPage,
});

// P25-B fix: a task is a "launch + workspace record" on a specific computer.
// The structured conversation view is gone and the PTY "Open terminal" landing
// page is retired — so this entry now REDIRECTS straight to the task's runtime
// session list (/computers/$computerId/agents/$agentKind), the one-click PTY
// list where each row reattaches in a single click. No intermediate page.
function TaskConversationPage() {
	const { taskId } = Route.useParams();
	const task = useQuery(orpc.tasks.get.queryOptions({ input: { taskId } }));

	if (task.isPending) {
		return (
			<div className="mx-auto w-full max-w-2xl p-4 sm:p-6">
				<p className="text-muted-foreground text-sm">Loading task…</p>
			</div>
		);
	}

	if (task.isError || !task.data) {
		return (
			<div className="mx-auto w-full max-w-2xl p-4 sm:p-6">
				<p className="rounded-lg bg-muted/40 p-6 text-center text-muted-foreground text-sm">
					This task wasn't found — it may have been removed, or the link is
					wrong.
				</p>
			</div>
		);
	}

	const { agentKind, computerId } = task.data.task;
	return (
		<Navigate
			params={{ agentKind, computerId }}
			replace
			to="/computers/$computerId/agents/$agentKind"
		/>
	);
}
