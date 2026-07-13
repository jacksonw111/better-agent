import { createFileRoute, redirect } from "@tanstack/react-router";

// The bridge UI lives at /local (P0 route split) — this route only exists so
// old links/bookmarks to /bridge don't 404. Redirects straight there rather
// than through /local-agents to avoid chaining redirects.
export const Route = createFileRoute("/bridge/")({
	beforeLoad: () => {
		throw redirect({ to: "/local" });
	},
});
