import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { LocalAgentWorkspace } from "@/components/bridge/local-agent-workspace";

export const Route = createFileRoute("/local/$tokenId")({
	component: LocalAgentWorkspacePage,
	// P2-T2: `?session=` names the selected session; absent means "follow the
	// newest" (the workspace's default), so plain /local/$tokenId links keep
	// their old behavior.
	// P2-2 (DP-PTY6): `?pty=<computerId>` opens the new xterm PTY terminal in
	// place of the legacy structured terminal (feature-gated coexistence — the
	// old renderer is removed in P2-3). `?ptySession=` optionally overrides which
	// PTY sessionId to attach to; it defaults to the selected bridge session.
	validateSearch: (
		search: Record<string, unknown>
	): { pty?: string; ptySession?: string; session?: string } => ({
		session: typeof search.session === "string" ? search.session : undefined,
		pty: typeof search.pty === "string" ? search.pty : undefined,
		ptySession:
			typeof search.ptySession === "string" ? search.ptySession : undefined,
	}),
});

/** One local agent's workspace: session sidebar + multi-tab content pane
 * (chat live today; files/git/shell land in P4). Selection round-trips
 * through the URL — sidebar clicks `replace` the search param so history
 * doesn't fill up with session hops, and loading a `?session=` link restores
 * that exact session. */
function LocalAgentWorkspacePage() {
	const { tokenId } = Route.useParams();
	const { session, pty, ptySession } = Route.useSearch();
	const navigate = useNavigate();
	return (
		<LocalAgentWorkspace
			onSelectSession={(sessionId) =>
				navigate({
					params: { tokenId },
					replace: true,
					search: (prev) => ({ ...prev, session: sessionId }),
					to: "/local/$tokenId",
				})
			}
			pty={pty ? { computerId: pty, sessionId: ptySession } : undefined}
			sessionId={session}
			tokenId={tokenId}
		/>
	);
}
