import { Badge } from "@better-agent/ui/components/badge";
import { ShieldOffIcon } from "lucide-react";
import type { BridgeSessionRow } from "@/utils/api-types";
import type { AgentCapabilities } from "./agent-capabilities";
import { AgentKindIcon } from "./local-agent-kind-icon";

// Split out of terminal-header.tsx purely to keep that file under the repo's
// 300-line cap — the header's session-identity cluster (icon + id + the
// ungated-agent warning badge), not itself capability-gated beyond the badge.

/** The wire `permissionMode` value that means "full-auto, allow everything" —
 * claude's SDK `bypassPermissions`. A session in it runs every tool call with
 * NO `canUseTool` approval prompt, so it wears the persistent warning badge
 * below (the same signal pi's always-ungated sessions get). */
const BYPASS_PERMISSIONS_MODE = "bypassPermissions";

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

/** Shown while a claude session's LIVE permission mode is `bypassPermissions`
 * (full-auto). Unlike pi's static `noApprovalGate` badge this tracks a runtime
 * value, so it appears/disappears as the owner switches the composer's
 * permission-mode menu in and out of bypass — a continuously-visible reminder
 * that nothing in this session will pause for approval right now. */
function BypassPermissionsBadge() {
	return (
		<Badge
			title="Full-auto: this session is running every tool call without an approval prompt — nothing here will pause for your review. Switch the permission-mode menu off 「Bypass permissions」 to restore approvals."
			variant="destructive"
		>
			<ShieldOffIcon className="size-3" />
			全自动 allow
		</Badge>
	);
}

/** The header's session-identity cluster: the agent icon plus the ungated
 * warning badge. The raw session id text was removed on user request
 * (2026-07-18) — the full id stays available as a tooltip on the icon.
 * `permissionMode` is the session's LIVE mode (from `session_ready`, patched
 * by `permission_mode_changed` read-backs) — it drives the bypass badge. */
export function SessionIdLabel({
	agentKind,
	caps,
	permissionMode,
	sessionId,
}: {
	agentKind: BridgeSessionRow["agentKind"];
	caps: AgentCapabilities;
	permissionMode?: string;
	sessionId: string;
}) {
	return (
		<span className="flex min-w-0 items-center gap-2" title={sessionId}>
			<AgentKindIcon
				className="size-4 shrink-0 text-muted-foreground"
				kind={agentKind}
			/>
			{caps.noApprovalGate && <NoApprovalGateBadge />}
			{permissionMode === BYPASS_PERMISSIONS_MODE && <BypassPermissionsBadge />}
		</span>
	);
}
