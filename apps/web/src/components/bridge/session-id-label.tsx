import { Badge } from "@better-agent/ui/components/badge";
import { ShieldOffIcon } from "lucide-react";
import type { BridgeSessionRow } from "@/utils/api-types";
import type { AgentCapabilities } from "./agent-capabilities";
import { AgentKindIcon } from "./local-agent-kind-icon";

// Split out of terminal-header.tsx purely to keep that file under the repo's
// 300-line cap — the header's session-identity cluster (icon + id + the
// ungated-agent warning badge), not itself capability-gated beyond the badge.

/** RC-T4: pi runs shell/tool calls with NO approval gate at all (see
 * `noApprovalGate`'s doc comment in agent-capabilities.ts) — this is the only
 * user-visible signal of that, so a user doesn't mistake pi for pausing on
 * tool calls the way claude/opencode do. */
function NoApprovalGateBadge() {
	return (
		<Badge
			title="pi runs shell and other tool calls without an approval prompt — nothing here will pause for your review."
			variant="destructive"
		>
			<ShieldOffIcon className="size-3" />
			Ungated
		</Badge>
	);
}

/** The header's session-identity cluster: the agent icon plus the ungated
 * warning badge. The raw session id text was removed on user request
 * (2026-07-18) — the full id stays available as a tooltip on the icon. */
export function SessionIdLabel({
	agentKind,
	caps,
	sessionId,
}: {
	agentKind: BridgeSessionRow["agentKind"];
	caps: AgentCapabilities;
	sessionId: string;
}) {
	return (
		<span className="flex min-w-0 items-center gap-2" title={sessionId}>
			<AgentKindIcon
				className="size-4 shrink-0 text-muted-foreground"
				kind={agentKind}
			/>
			{caps.noApprovalGate && <NoApprovalGateBadge />}
		</span>
	);
}
