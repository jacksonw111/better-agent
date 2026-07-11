import { Badge } from "@better-agent/ui/components/badge";
import { ShieldOffIcon } from "lucide-react";
import type { BridgeSessionRow } from "@/utils/api-types";
import type { AgentCapabilities } from "./agent-capabilities";
import { AgentKindIcon } from "./local-agent-kind-icon";

// Split out of terminal-header.tsx purely to keep that file under the repo's
// 300-line cap — the header's session-identity cluster (icon + id + the
// ungated-agent warning badge), not itself capability-gated beyond the badge.

/** Short enough to identify a session at a glance without dominating the row
 * — matches how git short-SHAs are conventionally truncated. */
const SESSION_ID_SHORT_LENGTH = 8;

function shortSessionId(id: string): string {
	return id.length > SESSION_ID_SHORT_LENGTH
		? `${id.slice(0, SESSION_ID_SHORT_LENGTH)}…`
		: id;
}

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

/** `Session: 11c186d9…` — the ONE prominent identifier for the session, the
 * agent/claude session id when the CLI has reported one, else the bridge
 * session id. Full id in the tooltip. Deliberately not the session `label`,
 * which is routinely "untitled". */
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
		<span className="flex min-w-0 items-center gap-2">
			<AgentKindIcon
				className="size-4 shrink-0 text-muted-foreground"
				kind={agentKind}
			/>
			<span className="truncate font-medium text-sm" title={sessionId}>
				Session: {shortSessionId(sessionId)}
			</span>
			{caps.noApprovalGate && <NoApprovalGateBadge />}
		</span>
	);
}
