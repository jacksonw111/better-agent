import { createFileRoute, redirect } from "@tanstack/react-router";

// The bridge UI moved to /agents (sidebar renamed "Local Agent") — this
// route only exists so old links/bookmarks to /bridge don't 404. Redirects
// straight to /agents rather than /local-agents to avoid chaining through
// that route's own redirect.
export const Route = createFileRoute("/bridge/")({
	beforeLoad: () => {
		throw redirect({ to: "/agents" });
	},
});
