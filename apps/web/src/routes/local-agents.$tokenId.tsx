import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/local-agents/$tokenId")({
	beforeLoad: ({ params }) => {
		throw redirect({
			search: { localAgentId: params.tokenId },
			to: "/chat",
		});
	},
});
