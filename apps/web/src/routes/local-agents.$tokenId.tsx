import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/local-agents/$tokenId")({
	beforeLoad: ({ params }) => {
		throw redirect({
			params: { tokenId: params.tokenId },
			to: "/local/$tokenId",
		});
	},
});
