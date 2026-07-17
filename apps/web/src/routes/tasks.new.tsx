import { createFileRoute, redirect } from "@tanstack/react-router";

// The New Task wizard moved from this standalone page into a modal on the
// task list. The URL keeps working as a deep link: it lands on /tasks with
// the modal already open (?new=1), starting at Step 1 as before.
export const Route = createFileRoute("/tasks/new")({
	beforeLoad: () => {
		throw redirect({ search: { new: true }, to: "/tasks" });
	},
});
