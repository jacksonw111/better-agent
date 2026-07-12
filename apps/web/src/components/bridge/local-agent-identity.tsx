import { useNavigate } from "@tanstack/react-router";
import { localAgentDisplayName } from "./local-agent-format";
import type { LocalAgentEntry } from "./local-agent-join";
import { AGENT_KIND_LABEL, AgentKindIcon } from "./local-agent-kind-icon";

/** The agent identity block shared by the table row and the mobile card: its
 * NAME is the ONLY navigation target (a text-styled button carrying the
 * detail-page link), so both views navigate identically and can't drift. */
export function LocalAgentIdentity({ entry }: { entry: LocalAgentEntry }) {
	const { token } = entry;
	const navigate = useNavigate();
	return (
		<div className="flex min-w-0 items-center gap-2">
			<AgentKindIcon
				className="size-4 shrink-0 text-muted-foreground"
				kind={token.agentKind}
			/>
			<div className="flex min-w-0 flex-col">
				<button
					className="truncate text-left font-medium hover:underline"
					onClick={() =>
						navigate({
							params: { tokenId: token.id },
							to: "/local-agents/$tokenId",
						})
					}
					type="button"
				>
					{localAgentDisplayName(entry)}
				</button>
				<span className="truncate text-muted-foreground text-xs">
					{AGENT_KIND_LABEL[token.agentKind]}
				</span>
			</div>
		</div>
	);
}
