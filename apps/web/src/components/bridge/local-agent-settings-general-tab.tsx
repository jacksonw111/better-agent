import { CopyAction } from "@better-agent/ui/components/actions";
import { TabsContent } from "@better-agent/ui/components/tabs";
import { AssignedMemories } from "@/components/memory/assigned-memories";
import type { BridgeTokenRow } from "@/utils/api-types";
import { AGENT_KIND_LABEL } from "./local-agent-kind-icon";

// General/Memories tab panels, split out of local-agent-settings-dialog.tsx
// purely to keep that file under the repo's max-lines-per-file gate.

const CODE_CLASS =
	"block w-full overflow-x-auto whitespace-nowrap rounded-md border bg-muted px-2 py-1.5 font-mono text-xs";

function Row({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex items-center gap-3">
			<dt className="w-32 shrink-0 text-muted-foreground text-xs">{label}</dt>
			<dd className="min-w-0 flex-1 font-medium text-sm">{children}</dd>
		</div>
	);
}

function formatConfigSummary(config: BridgeTokenRow["config"]): string {
	if (!config) {
		return "Defaults";
	}
	const parts: string[] = [];
	if (config.effort) {
		parts.push(`effort: ${config.effort}`);
	}
	if (config.maxTurns !== undefined) {
		parts.push(`${config.maxTurns} turns`);
	}
	if (config.maxBudgetUsd !== undefined) {
		parts.push(`$${config.maxBudgetUsd} cap`);
	}
	return parts.length > 0 ? parts.join(" · ") : "Defaults";
}

export function GeneralTab({ token }: { token: BridgeTokenRow }) {
	const raw = token.token;
	const created = new Date(token.createdAt);
	return (
		<TabsContent value="general">
			<dl className="flex flex-col gap-3">
				<Row label="Agent">{AGENT_KIND_LABEL[token.agentKind]}</Row>
				<Row label="Name">{token.name ?? "Untitled"}</Row>
				<Row label="Token">
					{raw ? (
						<div className="flex items-center gap-1.5">
							<code className={CODE_CLASS}>
								…{token.last4 ?? raw.slice(-4)}
							</code>
							<CopyAction label="Copy token" text={raw} />
						</div>
					) : (
						<span className="text-muted-foreground">—</span>
					)}
				</Row>
				<Row label="Token usage">{formatConfigSummary(token.config)}</Row>
				<Row label="Created">
					{created.toLocaleDateString(undefined, {
						year: "numeric",
						month: "short",
						day: "numeric",
					})}
				</Row>
			</dl>
		</TabsContent>
	);
}

/** The memories this local agent can search (M1): assign/unassign the user's
 * memories and toggle each link's read/read & write role. */
export function MemoriesTab({ token }: { token: BridgeTokenRow }) {
	return (
		<TabsContent value="memories">
			<AssignedMemories target={{ tokenId: token.id }} />
		</TabsContent>
	);
}
