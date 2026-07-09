import { Label } from "@better-agent/ui/components/label";
import { McpServersField } from "../agents/mcp-servers-field";
import type { ConfigDraft } from "./local-agent-config-form";

// R5-a: the local-agent Config tab's MCP-servers picker, split out of
// local-agent-config-form.tsx to keep that file under the repo's 300-line
// limit (same pattern as local-agent-model-permission-fields.tsx). Reuses
// McpServersField (apps/web/src/components/agents/mcp-servers-field.tsx) —
// the same multi-select agents use to link their own registered MCP servers.

interface FieldProps {
	draft: ConfigDraft;
	onDraft: (next: ConfigDraft) => void;
}

/** Assigns registered MCP servers to this local-agent token. Shown for every
 * agent kind (all local agents can benefit from MCP tools), even ones whose
 * bridge adapter doesn't apply the rest of the Config tab's fields — the
 * server resolves the assignment into connection-ready `mcpServers`
 * regardless (see `bridge-mcp-resolve.ts`); the CLI actually wiring them into
 * the launched agent process is R5-b, not yet done for any adapter. */
export function McpServersConfigField({ draft, onDraft }: FieldProps) {
	return (
		<div className="flex flex-col gap-2">
			<Label>MCP servers</Label>
			<McpServersField
				onChange={(ids) => onDraft({ ...draft, mcpServerIds: ids })}
				selected={draft.mcpServerIds}
			/>
			<p className="text-muted-foreground text-xs">
				Applied on the next session start — restart the agent (or reconnect) to
				pick up changes.
			</p>
		</div>
	);
}
