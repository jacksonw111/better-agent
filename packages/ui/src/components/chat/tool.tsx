import { Collapsible } from "@base-ui/react/collapsible";
import { cn } from "@better-agent/ui/lib/utils";
import {
	CheckIcon,
	ChevronDownIcon,
	Loader2Icon,
	WrenchIcon,
	XIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import type { ToolInvocation } from "./chat-blocks";

const MAX_VALUE_CHARS = 2000;

/** An app-supplied hook: render a rich component for a successful tool
 * result, or return null to keep the raw-JSON tool block. */
export type RenderToolResult = (
	toolName: string,
	result: unknown
) => ReactNode | null;

/** An app-supplied hook that renders the ENTIRE tool card — header, input, and
 * result across every status (running/complete/error), not just the result of
 * a finished call like `RenderToolResult`. Returning null falls back to the
 * default rich/plain rendering. The local-agent terminal uses this to render
 * real CLI executions (shell commands, file edits, reads) as terminal-style
 * cards; the web-agent chat leaves it unset and keeps `RenderToolResult`. */
export type RenderTool = (tool: ToolInvocation) => ReactNode | null;

function formatValue(value: unknown): string {
	if (value === undefined) {
		return "";
	}
	let text: string;
	if (typeof value === "string") {
		text = value;
	} else {
		try {
			text = JSON.stringify(value, null, 2);
		} catch {
			text = String(value);
		}
	}
	return text.length > MAX_VALUE_CHARS
		? `${text.slice(0, MAX_VALUE_CHARS)}\n…(truncated)`
		: text;
}

function StatusIcon({ status }: { status: ToolInvocation["status"] }) {
	if (status === "running") {
		return (
			<Loader2Icon className="size-3.5 animate-spin text-muted-foreground" />
		);
	}
	if (status === "error") {
		return <XIcon className="size-3.5 text-destructive" />;
	}
	return <CheckIcon className="size-3.5 text-muted-foreground" />;
}

// A registered renderer only ever runs against a completed, successful call —
// isError and in-flight results keep the plain JSON section (or the error
// banner above it).
function richResult(
	tool: ToolInvocation,
	renderToolResult?: RenderToolResult
): ReactNode | null {
	if (tool.isError || tool.status !== "complete" || !renderToolResult) {
		return null;
	}
	return renderToolResult(tool.toolName, tool.result);
}

// A registered rich result renders ALWAYS-VISIBLE (never hidden behind the
// collapsible), with the raw call folded into a subtle "details" disclosure
// beneath it — otherwise the component the whole feature exists to show sat
// collapsed and users only ever saw a plain tool-call row.
function RichToolView({
	tool,
	rich,
}: {
	tool: ToolInvocation;
	rich: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			{rich}
			<Collapsible.Root className="rounded-md">
				<Collapsible.Trigger className="flex items-center gap-1.5 text-muted-foreground text-xs hover:text-foreground">
					<WrenchIcon className="size-3" />
					<span className="font-mono">{tool.toolName}</span>
					<ChevronDownIcon className="size-3 transition-transform data-[panel-open]:rotate-180" />
				</Collapsible.Trigger>
				<Collapsible.Panel className="mt-1.5 flex flex-col gap-2">
					<ToolSection label="Arguments" value={formatValue(tool.args)} />
					<ToolSection label="Raw result" value={formatValue(tool.result)} />
				</Collapsible.Panel>
			</Collapsible.Root>
		</div>
	);
}

// The plain (unregistered / errored / in-flight) tool block: a collapsible row
// showing name + status, expanding to arguments and the raw JSON result.
function PlainToolView({ tool }: { tool: ToolInvocation }) {
	return (
		<Collapsible.Root
			className={cn(
				"rounded-md border bg-muted/40 p-2",
				tool.isError && "border-destructive/40"
			)}
			defaultOpen={tool.isError}
		>
			<Collapsible.Trigger className="flex w-full items-center gap-1.5 text-muted-foreground text-xs hover:text-foreground">
				<WrenchIcon className="size-3.5" />
				<span className="font-mono">{tool.toolName}</span>
				<StatusIcon status={tool.status} />
				<ChevronDownIcon className="ml-auto size-3.5 transition-transform data-[panel-open]:rotate-180" />
			</Collapsible.Trigger>
			{tool.isError ? (
				<p className="mt-1.5 break-words text-destructive text-xs">
					{formatValue(tool.result) || "Tool call failed."}
				</p>
			) : null}
			<Collapsible.Panel className="mt-2 flex flex-col gap-2">
				<ToolSection label="Arguments" value={formatValue(tool.args)} />
				{tool.status === "running" ? null : (
					<ToolSection label="Result" value={formatValue(tool.result)} />
				)}
			</Collapsible.Panel>
		</Collapsible.Root>
	);
}

function ToolInvocationView({
	tool,
	renderTool,
	renderToolResult,
}: {
	tool: ToolInvocation;
	renderTool?: RenderTool;
	renderToolResult?: RenderToolResult;
}) {
	// A full-card renderer wins when it claims the tool (non-null); otherwise
	// fall through to the result-only rich renderer, then the plain block.
	const custom = renderTool?.(tool);
	if (custom != null) {
		return <>{custom}</>;
	}
	const rich = richResult(tool, renderToolResult);
	if (rich !== null) {
		return <RichToolView rich={rich} tool={tool} />;
	}
	return <PlainToolView tool={tool} />;
}

function ToolSection({ label, value }: { label: string; value: string }) {
	if (value === "") {
		return null;
	}
	return (
		<div className="flex flex-col gap-1">
			<span className="text-muted-foreground text-xs uppercase tracking-wide">
				{label}
			</span>
			<pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-background/60 p-2 font-mono text-muted-foreground text-xs">
				{value}
			</pre>
		</div>
	);
}

export function ToolGroup({
	tools,
	renderTool,
	renderToolResult,
}: {
	tools: ToolInvocation[];
	renderTool?: RenderTool;
	renderToolResult?: RenderToolResult;
}) {
	if (tools.length === 0) {
		return null;
	}
	return (
		<div className="flex flex-col gap-2">
			{tools.map((tool) => (
				<ToolInvocationView
					key={tool.callId}
					renderTool={renderTool}
					renderToolResult={renderToolResult}
					tool={tool}
				/>
			))}
		</div>
	);
}
