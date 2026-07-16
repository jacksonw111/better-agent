import { createFileRoute, redirect } from "@tanstack/react-router";

// S3-T3: the /local list surface is retired — Tasks (and Computers) replaced
// it. Existing bridge data isn't destroyed: a token's workspace stays
// reachable by direct link at /local/$tokenId; only this list entry point
// converges onto /tasks.
export const Route = createFileRoute("/local/")({
	beforeLoad: () => {
		throw redirect({ to: "/tasks" });
	},
});
