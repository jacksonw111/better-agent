import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";
import { PageContainer } from "@/components/layout/page-container";

export const Route = createFileRoute("/tasks/$taskId")({
	component: TaskConversationPage,
});

// Placeholder only — the Task Conversation page (opening message + run view)
// lands with S3-T2. The route exists now so the task list and the wizard's
// post-Start navigation have a stable target.
function TaskConversationPage() {
	return (
		<PageContainer>
			<Link
				className="flex w-fit items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
				to="/tasks"
			>
				<ArrowLeftIcon className="size-4" />
				Tasks
			</Link>
			<p className="text-muted-foreground text-sm">
				The task conversation lands with S3-T2 — the task was created and its
				run is on the way to your computer.
			</p>
		</PageContainer>
	);
}
