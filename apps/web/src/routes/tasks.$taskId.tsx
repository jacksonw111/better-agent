import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";
import { OpenPtyTerminalButton } from "@/components/pty/open-pty-terminal-button";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/tasks/$taskId")({
	component: TaskConversationPage,
});

// P2-3: the legacy structured task conversation (its message stream + tool
// cards) was deleted with the rest of the structured-rendering stack. A task
// is a "launch + workspace record" on a specific computer, so this entry now
// opens that computer's native PTY terminal for the task's runtime/project
// instead of replaying a parsed conversation.
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

	const { computerName, task: detail } = task.data;
	return (
		<div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 sm:p-6">
			<Link
				className="flex w-fit items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
				params={{ computerId: detail.computerId }}
				to="/computers/$computerId"
			>
				<ArrowLeftIcon className="size-4" />
				{computerName ?? "Computer"}
			</Link>
			<div className="flex flex-col gap-1">
				<h1 className="font-semibold text-lg">{detail.name ?? "Task"}</h1>
				<p className="text-muted-foreground text-sm">
					The structured conversation view has been replaced by the native PTY
					terminal. Open a terminal on this task's computer to continue.
				</p>
			</div>
			<OpenPtyTerminalButton
				agentKind={detail.agentKind}
				computerId={detail.computerId}
				projectId={detail.projectId ?? undefined}
			>
				Open terminal
			</OpenPtyTerminalButton>
		</div>
	);
}
