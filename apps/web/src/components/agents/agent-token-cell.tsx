import { CopyAction } from "@better-agent/ui/components/actions";
import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/utils/orpc";

const TOKEN_PREVIEW_LEN = 14;

/** An agent's bridge token, previewed + copyable — shared by the desktop
 * table row and the mobile card so both fetch/render it identically. */
export function AgentTokenCell({ agentId }: { agentId: string }) {
	const tokenQuery = useQuery(
		orpc.agents.getToken.queryOptions({ input: { id: agentId } })
	);
	const token = tokenQuery.data ?? null;
	if (!token) {
		return <span className="text-muted-foreground text-xs">—</span>;
	}
	return (
		<div className="flex items-center gap-1">
			<code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
				{token.slice(0, TOKEN_PREVIEW_LEN)}…
			</code>
			<CopyAction label="Copy token" text={token} />
		</div>
	);
}
