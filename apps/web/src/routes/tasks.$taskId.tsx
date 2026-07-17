import { createFileRoute } from "@tanstack/react-router";
import { TaskConversation } from "@/components/tasks/task-conversation";

export const Route = createFileRoute("/tasks/$taskId")({
	component: TaskConversationPage,
});

/** P3: one session's chat — sibling-session sidebar, opening message +
 * earlier runs' history + the current run's session stream, with run
 * status/errors outside the chat and the Files/Git/Shell inspection tabs
 * alongside. Keyed by taskId so switching sessions remounts the page and its
 * lifecycle (auto-resume guard included) fresh. Fills the shell like
 * /local/$tokenId (immersive on <md — see use-immersive-chat.ts). */
function TaskConversationPage() {
	const { taskId } = Route.useParams();
	return <TaskConversation key={taskId} taskId={taskId} />;
}
