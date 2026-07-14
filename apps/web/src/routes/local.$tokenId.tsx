import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { LocalAgentWorkspace } from "@/components/bridge/local-agent-workspace";

export const Route = createFileRoute("/local/$tokenId")({
	component: LocalAgentWorkspacePage,
	// P2-T2: `?session=` names the selected session; absent means "follow the
	// newest" (the workspace's default), so plain /local/$tokenId links keep
	// their old behavior.
	validateSearch: (search: Record<string, unknown>): { session?: string } => ({
		session: typeof search.session === "string" ? search.session : undefined,
	}),
});

/** One local agent's workspace: session sidebar + multi-tab content pane
 * (chat live today; files/git/shell land in P4). Selection round-trips
 * through the URL — sidebar clicks `replace` the search param so history
 * doesn't fill up with session hops, and loading a `?session=` link restores
 * that exact session. */
function LocalAgentWorkspacePage() {
	const { tokenId } = Route.useParams();
	const { session } = Route.useSearch();
	const navigate = useNavigate();
	return (
		<LocalAgentWorkspace
			onSelectSession={(sessionId) =>
				navigate({
					params: { tokenId },
					replace: true,
					search: { session: sessionId },
					to: "/local/$tokenId",
				})
			}
			sessionId={session}
			tokenId={tokenId}
		/>
	);
}
