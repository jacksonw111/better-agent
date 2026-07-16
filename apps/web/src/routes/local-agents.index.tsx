import { createFileRoute, redirect } from "@tanstack/react-router";

// Legacy alias of the retired /local list — straight to /tasks (S3-T3),
// rather than chaining through /local's own redirect.
export const Route = createFileRoute("/local-agents/")({
	beforeLoad: () => {
		throw redirect({ to: "/tasks" });
	},
});
