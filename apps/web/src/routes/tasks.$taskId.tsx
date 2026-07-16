import { createFileRoute } from "@tanstack/react-router";
import { TaskConversation } from "@/components/tasks/task-conversation";

export const Route = createFileRoute("/tasks/$taskId")({
	component: TaskConversationPage,
});

/** S3-T2: the Task Conversation — opening message + the current run's session
 * stream, with run status/errors outside the chat and the Files/Git/Shell
 * inspection tabs alongside. Fills the shell like /local/$tokenId (immersive
 * on <md — see use-immersive-chat.ts). */
function TaskConversationPage() {
	const { taskId } = Route.useParams();
	return <TaskConversation taskId={taskId} />;
}
