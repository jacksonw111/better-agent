import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/local-agents/")({
	beforeLoad: () => {
		throw redirect({ to: "/agents" });
	},
});
