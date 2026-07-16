import { createFileRoute, redirect } from "@tanstack/react-router";

// S3-T3: the legacy /local-agents/* aliases converge onto /tasks. The kept
// direct-link inspection page for existing bridge sessions lives only at
// /local/$tokenId.
export const Route = createFileRoute("/local-agents/$tokenId")({
	beforeLoad: () => {
		throw redirect({ to: "/tasks" });
	},
});
