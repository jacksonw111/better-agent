import type { ToolInvocation } from "@better-agent/ui/components/chat/chat-blocks";
import { PlugZapIcon } from "lucide-react";
import { useState } from "react";
import { ToolCardHeaderRow, ToolCardShell } from "./tool-card-shell";
import {
	computeErrorLine,
	computeOutput,
	computeTail,
	ErrorPreviewLine,
	rawParamsText,
	TailLine,
} from "./tool-output-preview";

// fix-tool-render-gaps (G2): the unified card for a real MCP tool call
// (`mcp__<server>__<tool>`) — the platform's core "agent calls an external
// tool" surface. Replaces the random command/edit/search/raw misclassification
// the old substring `categoryOf` produced: one plug-badged card that names the
// server and tool, shows the call's arguments, and renders its result (a text
// envelope flattens to plain text; a structured result pretty-prints as JSON).

const MCP_PREFIX = "mcp__";
const SERVER_TOOL_SEPARATOR = "__";

export interface McpToolName {
	server: string;
	tool: string;
}

/** True for a real MCP tool call, whose wire name the SDK namespaces as
 * `mcp__<server>__<tool>` (see the bridge's claude-code normalizer). */
export function isMcpToolName(name: string): boolean {
	return name.startsWith(MCP_PREFIX);
}

/** Splits `mcp__<server>__<tool>` into its server and tool halves. The server
 * is the first segment after the prefix (its own underscores are single); the
 * tool is everything past the first `__` delimiter. Tolerant of a missing tool
 * half (`mcp__server`) — the tool comes back empty rather than throwing. */
export function parseMcpToolName(name: string): McpToolName {
	const rest = name.slice(MCP_PREFIX.length);
	const separator = rest.indexOf(SERVER_TOOL_SEPARATOR);
	if (separator === -1) {
		return { server: rest, tool: "" };
	}
	return {
		server: rest.slice(0, separator),
		tool: rest.slice(separator + SERVER_TOOL_SEPARATOR.length),
	};
}

function McpParamsSection({ text }: { text: string }) {
	if (!text) {
		return null;
	}
	return (
		<div className="flex flex-col gap-1 px-2 pb-2">
			<span className="text-muted-foreground text-xs">Arguments</span>
			<pre className="max-h-60 overflow-auto whitespace-pre rounded-md bg-background/60 px-2 py-1.5 font-mono text-muted-foreground text-xs leading-relaxed">
				{text}
			</pre>
		</div>
	);
}

function McpResultSection({ text }: { text: string }) {
	if (!text) {
		return null;
	}
	return (
		<div className="flex flex-col gap-1 px-2 pb-2">
			<span className="text-muted-foreground text-xs">Result</span>
			<pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background/60 px-2 py-1.5 font-mono text-muted-foreground text-xs leading-relaxed">
				{text}
			</pre>
		</div>
	);
}

function McpTitle({ server, tool }: McpToolName) {
	return (
		<span className="truncate">
			<span className="text-foreground">{server}</span>
			{tool ? (
				<>
					<span className="px-1 text-muted-foreground">·</span>
					<span className="text-foreground">{tool}</span>
				</>
			) : null}
		</span>
	);
}

/** The unified MCP tool card (G2). */
export function McpToolCard({ tool }: { tool: ToolInvocation }) {
	const parsed = parseMcpToolName(tool.toolName);
	const params = rawParamsText(tool.args);
	const output = computeOutput(tool);
	const hasBody = params !== "" || output !== "";
	const [open, setOpen] = useState(tool.isError);
	const tail = computeTail(tool);
	const errorLine = computeErrorLine(tool, hasBody, open);
	return (
		<ToolCardShell isError={tool.isError}>
			<ToolCardHeaderRow
				hasBody={hasBody}
				icon={<PlugZapIcon className="size-3.5 shrink-0 text-violet-500" />}
				label="MCP"
				onToggle={() => setOpen((value) => !value)}
				open={open}
				title={<McpTitle server={parsed.server} tool={parsed.tool} />}
				tool={tool}
			/>
			<TailLine tail={tail} />
			<ErrorPreviewLine text={errorLine} />
			{open ? (
				<>
					<McpParamsSection text={params} />
					<McpResultSection text={output} />
				</>
			) : null}
		</ToolCardShell>
	);
}
