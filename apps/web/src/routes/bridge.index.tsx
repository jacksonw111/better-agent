import { createFileRoute, redirect } from "@tanstack/react-router";

// The oldest alias of the local-agents surface — kept only so ancient
// links/bookmarks to /bridge don't 404. S3-T3 retired that surface, so this
// goes straight to /tasks (no chaining through /local's own redirect).
export const Route = createFileRoute("/bridge/")({
	beforeLoad: () => {
		throw redirect({ to: "/tasks" });
	},
});
