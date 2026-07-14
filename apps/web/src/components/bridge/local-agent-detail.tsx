import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { BridgeSessionRow, BridgeTokenRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";
import { createBridgeTransport } from "./bridge-transport";
import { LocalAgentConnectionPanel } from "./local-agent-connection-panel";
import { RemoteDesktopPanel } from "./remote-desktop-panel";
import { Terminal } from "./terminal";

// P2-T2 (docs/local-agent-workspace-plan.md): the workspace content pane's
// building blocks. `LocalAgentDetail` (which owned the queries + session
// selection) is gone — `LocalAgentWorkspace` owns those now, shares them with
// the session sidebar, and feeds the CONTROLLED `SessionView` below.

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
export function WaitingForCli({ token }: { token: BridgeTokenRow }) {
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

export function LocalAgentNotFound() {
	return (
		<p className="rounded-lg bg-muted/40 p-6 text-center text-muted-foreground text-sm">
			This local agent wasn't found — it may have been removed, or the link is
			wrong.
		</p>
	);
}

/** The terminal (plus the optional remote-desktop panel) for the session the
 * workspace selected. Controlled: `activeSession` comes from the workspace's
 * URL-synced selection (sidebar rows write `?session=`), so the header no
 * longer needs its own session-picker dropdown — `sessions`/`onSelectSession`
 * are deliberately NOT passed to `Terminal`, which hides that picker. The
 * terminal stays keyed by session id so switching remounts it onto the chosen
 * session instead of re-polling the previous one. */
export function SessionView({
	activeSession,
	token,
	userAvatarUrl,
}: {
	activeSession: BridgeSessionRow;
	token: BridgeTokenRow;
	userAvatarUrl: string | undefined;
}) {
	const endSession = useEndSession();
	const transport = useMemo(() => createBridgeTransport(), []);
	// A session is CUA-capable once we've seen it expose a VNC endpoint. Latched
	// so the Start/Stop panel stays after the VM is stopped (endpoint clears),
	// and never shows for a plain (non-`--cua`) session.
	const [cuaSeen, setCuaSeen] = useState(false);
	const vncEndpoint = activeSession.vncEndpoint ?? null;
	useEffect(() => {
		if (vncEndpoint) {
			setCuaSeen(true);
		}
	}, [vncEndpoint]);

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
				session={activeSession}
				token={token}
				transport={transport}
				userAvatarUrl={userAvatarUrl}
			/>
		</div>
	);
}
