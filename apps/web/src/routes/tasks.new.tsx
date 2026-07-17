import { createFileRoute, redirect } from "@tanstack/react-router";

// The New Task wizard has no UI entry point anymore (P3: sessions start
// directly from an agent's session list). The old deep link lands on
// /computers, where sessions are started per agent.
export const Route = createFileRoute("/tasks/new")({
	beforeLoad: () => {
		throw redirect({ to: "/computers" });
	},
});
