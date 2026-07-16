import { Button } from "@better-agent/ui/components/button";
import { SettingsIcon } from "lucide-react";
import { useState } from "react";
import type { BridgeTokenRow } from "@/utils/api-types";
import { localAgentDisplayName } from "./local-agent-format";
import { AGENT_KIND_LABEL, AgentKindIcon } from "./local-agent-kind-icon";
import { LocalAgentSettingsDialog } from "./local-agent-settings-dialog";

/** The always-present header of a bound local agent's page: its name + agent
 * kind, plus its settings dialog. S3-T3 retired the token create/copy flow
 * (this panel used to surface the raw bridge token and a ready-to-run CLI
 * command) — the /local/$tokenId workspace survives only as a direct-link
 * inspection page for existing sessions, so no connect entry points remain. */
export function LocalAgentConnectionPanel({
	token,
}: {
	token: BridgeTokenRow;
}) {
	const [settingsOpen, setSettingsOpen] = useState(false);
	return (
		<div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4">
			<div className="flex min-w-0 items-center gap-2">
				<AgentKindIcon
					className="size-4 shrink-0 text-muted-foreground"
					kind={token.agentKind}
				/>
				<span className="truncate font-medium text-sm">
					{localAgentDisplayName({
						latestSession: null,
						status: "not-connected",
						token,
					})}
				</span>
				<span className="shrink-0 text-muted-foreground text-xs">
					{AGENT_KIND_LABEL[token.agentKind]}
				</span>
				<div className="ml-auto">
					<Button
						aria-label="Settings"
						onClick={() => setSettingsOpen(true)}
						size="icon-sm"
						variant="ghost"
					>
						<SettingsIcon className="size-4" />
					</Button>
					{settingsOpen && (
						<LocalAgentSettingsDialog
							onOpenChange={setSettingsOpen}
							open={settingsOpen}
							token={token}
						/>
					)}
				</div>
			</div>
		</div>
	);
}
