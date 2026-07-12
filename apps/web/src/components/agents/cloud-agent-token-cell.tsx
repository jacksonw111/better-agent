import { CopyAction } from "@better-agent/ui/components/actions";
import { Button } from "@better-agent/ui/components/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@better-agent/ui/components/popover";
import type { UseQueryResult } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { KeyRoundIcon } from "lucide-react";
import { useState } from "react";
import { orpc } from "@/utils/orpc";

const CODE_CLASS =
	"block w-full overflow-x-auto whitespace-nowrap rounded-md border bg-muted px-2 py-1.5 font-mono text-xs";
const LAST4_LEN = -4;

/** The popover body: loading / error+retry / token+copy, split out so
 * `CloudAgentTokenCell` stays under the line-count gate. */
function TokenPopoverBody({
	tokenQuery,
}: {
	tokenQuery: UseQueryResult<string | null>;
}) {
	if (tokenQuery.isPending) {
		return <p className="text-muted-foreground text-xs">Loading…</p>;
	}
	if (tokenQuery.isError) {
		return (
			<div className="flex items-center gap-1.5">
				<p className="text-destructive text-xs">
					{tokenQuery.error instanceof Error
						? tokenQuery.error.message
						: "Failed to load token"}
				</p>
				<Button
					onClick={() => tokenQuery.refetch()}
					size="sm"
					variant="outline"
				>
					Retry
				</Button>
			</div>
		);
	}
	const token = tokenQuery.data;
	if (!token) {
		// Loaded, but the agent has no token — mirror LocalAgentTokenCell's
		// muted missing-token treatment.
		return <p className="text-muted-foreground text-xs">No token</p>;
	}
	return (
		<div className="flex items-center gap-1.5">
			<code className={CODE_CLASS}>{token}</code>
			<CopyAction label="Copy token" text={token} />
		</div>
	);
}

/** The token cell for the cloud Agents table, restyled to match
 * `LocalAgentTokenCell`: a quiet `…<last4>` chip that opens a popover with
 * the full copyable token. Unlike the old `AgentTokenCell`, this fetches
 * `getToken` only once the popover opens (`enabled: open`), avoiding an
 * N+1 query per row on the merged agents list. */
export function CloudAgentTokenCell({ agentId }: { agentId: string }) {
	const [open, setOpen] = useState(false);
	const tokenQuery = useQuery({
		...orpc.agents.getToken.queryOptions({ input: { id: agentId } }),
		enabled: open,
	});
	const token = tokenQuery.data ?? null;

	return (
		<Popover onOpenChange={setOpen} open={open}>
			<PopoverTrigger
				render={
					<button
						className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-muted-foreground text-xs hover:bg-muted hover:text-foreground"
						title="Show token"
						type="button"
					/>
				}
			>
				<KeyRoundIcon className="size-3" />…
				{token ? token.slice(LAST4_LEN) : "····"}
			</PopoverTrigger>
			<PopoverContent align="start" className="w-80">
				<div className="flex flex-col gap-2">
					<div>
						<p className="mb-1 text-muted-foreground text-xs">Agent token</p>
						<TokenPopoverBody tokenQuery={tokenQuery} />
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}
