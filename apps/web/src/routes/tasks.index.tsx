import { createFileRoute, redirect } from "@tanstack/react-router";

// P3: the task list retired — the product surface is computer -> agent ->
// sessions. Old /tasks links (and the legacy /local, /bridge redirect chains
// that land here) converge onto /computers.
export const Route = createFileRoute("/tasks/")({
	beforeLoad: () => {
		throw redirect({ to: "/computers" });
	},
});
