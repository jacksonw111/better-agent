import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { BridgeSessionRow, BridgeTokenRow } from "@/utils/api-types";
import { userAvatar } from "@/utils/avatar";
import { orpc } from "@/utils/orpc";
import { useCurrentUser } from "@/utils/use-current-user";
import { createBridgeTransport } from "./bridge-transport";
import { LocalAgentConnectionPanel } from "./local-agent-connection-panel";
import { LocalAgentDetailSkeleton } from "./local-agent-detail-skeleton";
import { deriveLocalAgentEntries } from "./local-agent-join";
import { withSessionPolling } from "./local-agent-poll";
import {
	sortSessionsByRecency,
	useSessionSelection,
} from "./local-agent-session-picker";
import { RemoteDesktopPanel } from "./remote-desktop-panel";
import { Terminal } from "./terminal";

function useEndSession() {
	const queryClient = useQueryClient();
	return useMutation(
		orpc.bridge.endSession.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.bridge.listSessions.key(),
				});
			},
			onError: (error) => toast.error(error.message),
		})
	);
}

/** Friendly state for a token whose CLI has never connected: mounts the
 * connection guide panel (token + ready-to-run `agent-cli` command) right
 * above the status note, so "Run the command above" actually has a command
 * above it — R1-T1: `LocalAgentConnectionPanel` used to be built but never
 * rendered anywhere. */
function WaitingForCli({ token }: { token: BridgeTokenRow }) {
	return (
		<div className="flex flex-col gap-4">
			<LocalAgentConnectionPanel token={token} />
			<div className="rounded-lg bg-muted/40 p-6">
				<p className="font-medium text-sm">Waiting for the CLI to connect</p>
				<p className="text-muted-foreground text-sm">
					Run the command above from your project directory to connect this
					local agent.
				</p>
			</div>
		</div>
	);
}

function NotFound() {
	return (
		<p className="rounded-lg bg-muted/40 p-6 text-center text-muted-foreground text-sm">
			This local agent wasn't found — it may have been removed, or the link is
			wrong.
		</p>
	);
}

/** The picker + terminal for a token that has at least one session. The picker
 * chooses which session the terminal follows (default: most recent); the
 * terminal is keyed by session id so switching remounts it onto the chosen
 * session instead of re-polling the previous one. */
function SessionView({
	sessions,
	token,
	userAvatarUrl,
}: {
	sessions: BridgeSessionRow[];
	token: BridgeTokenRow;
	userAvatarUrl: string | undefined;
}) {
	const endSession = useEndSession();
	const transport = useMemo(() => createBridgeTransport(), []);
	const { activeSession, select } = useSessionSelection(sessions);
	// A session is CUA-capable once we've seen it expose a VNC endpoint. Latched
	// so the Start/Stop panel stays after the VM is stopped (endpoint clears),
	// and never shows for a plain (non-`--cua`) session.
	const [cuaSeen, setCuaSeen] = useState(false);
	const vncEndpoint = activeSession?.vncEndpoint ?? null;
	useEffect(() => {
		if (vncEndpoint) {
			setCuaSeen(true);
		}
	}, [vncEndpoint]);

	if (!activeSession) {
		return <WaitingForCli token={token} />;
	}
	return (
		<div className="flex min-h-0 flex-1 flex-col gap-4">
			{cuaSeen ? (
				<RemoteDesktopPanel
					sessionId={activeSession.id}
					transport={transport}
					vncEndpoint={vncEndpoint}
				/>
			) : null}
			<Terminal
				activeSessionId={activeSession.id}
				ending={endSession.isPending}
				key={activeSession.id}
				onEnd={() => endSession.mutate({ sessionId: activeSession.id })}
				onSelectSession={select}
				session={activeSession}
				sessions={sessions}
				token={token}
				transport={transport}
				userAvatarUrl={userAvatarUrl}
			/>
		</div>
	);
}

/**
 * The `/local-agents/$tokenId` body. One bridge token = one persistent local
 * agent. Joins the same `listTokens` + `listSessions` queries the list page
 * polls (shared cache), then:
 *  - unknown/revoked token → not-found;
 *  - token with no session yet → waiting-for-CLI;
 *  - token with sessions → connection panel + a session picker over that
 *    token's sessions, defaulting to the most recent, feeding the `Terminal`.
 */
export function LocalAgentDetail({ tokenId }: { tokenId: string }) {
	const tokens = useQuery(orpc.bridge.listTokens.queryOptions());
	const sessions = useQuery(
		withSessionPolling(orpc.bridge.listSessions.queryOptions())
	);
	const { email } = useCurrentUser();

	if (tokens.isPending || sessions.isPending) {
		return <LocalAgentDetailSkeleton />;
	}

	const entries = deriveLocalAgentEntries(
		tokens.data ?? [],
		sessions.data ?? []
	);
	const entry = entries.find((candidate) => candidate.token.id === tokenId);
	if (!entry) {
		return <NotFound />;
	}

	const tokenSessions = sortSessionsByRecency(
		(sessions.data ?? []).filter((session) => session.tokenId === tokenId)
	);

	return tokenSessions.length > 0 ? (
		<SessionView
			sessions={tokenSessions}
			token={entry.token}
			userAvatarUrl={email ? userAvatar(email) : undefined}
		/>
	) : (
		<WaitingForCli token={entry.token} />
	);
}
