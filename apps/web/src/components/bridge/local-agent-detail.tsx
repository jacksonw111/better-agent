import type { BridgeTokenRow } from "@/utils/api-types";
import { LocalAgentConnectionPanel } from "./local-agent-connection-panel";

// P2-T2 (docs/local-agent-workspace-plan.md): the workspace content pane's
// building blocks. `LocalAgentDetail` (which owned the queries + session
// selection) is gone — `LocalAgentWorkspace` owns those now, shares them with
// the session sidebar. P2-3 deleted the legacy structured `SessionView`
// terminal (and its bridge transport / remote-desktop panel): the live
// terminal is now the native PTY xterm (`components/pty/`), which the workspace
// renders directly. Only the non-terminal states survive here.

/** Friendly state for a token whose CLI has never connected: the identity
 * panel above a status note. S3-T3 retired the connect flow (the panel no
 * longer surfaces the token or a ready-to-run command) — this page survives
 * only as a direct-link inspection surface; new work starts from Tasks. */
export function WaitingForCli({ token }: { token: BridgeTokenRow }) {
	return (
		<div className="flex flex-col gap-4">
			<LocalAgentConnectionPanel token={token} />
			<div className="rounded-lg bg-muted/40 p-6">
				<p className="font-medium text-sm">Waiting for the CLI to connect</p>
				<p className="text-muted-foreground text-sm">
					This local agent has no sessions yet. New local work now starts from
					Tasks — this page stays available for the agent's existing sessions.
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
