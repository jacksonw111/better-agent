import { Collapsible } from "@base-ui/react/collapsible";
import { cn } from "@better-agent/ui/lib/utils";
import { ChevronDownIcon, WrenchIcon } from "lucide-react";
import type { ToolInvocation } from "./chat-blocks";
import { renderFromRegistry, type ToolRegistry } from "./tool-registry";
import { ToolStatusIcon } from "./tool-status-icon";

const MAX_VALUE_CHARS = 2000;

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

// The plain (unregistered / errored / in-flight) tool block: a collapsible row
// showing name + status, expanding to arguments and the raw JSON result.
function PlainToolView({ tool }: { tool: ToolInvocation }) {
	return (
		<Collapsible.Root
			className={cn(
				"overflow-hidden rounded-md bg-muted/40 text-xs",
				tool.isError && "bg-destructive/10"
			)}
			defaultOpen={tool.isError}
		>
			<Collapsible.Trigger className="flex w-full items-center gap-2 px-2 py-1.5 text-left">
				<WrenchIcon className="size-3.5 shrink-0 text-muted-foreground" />
				<span className="font-mono text-foreground">{tool.toolName}</span>
				<ToolStatusIcon status={tool.status} />
				<ChevronDownIcon className="ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform data-[panel-open]:rotate-180" />
			</Collapsible.Trigger>
			{tool.isError ? (
				<p className="break-words px-2 py-1.5 text-destructive">
					{formatValue(tool.result) || "Tool call failed."}
				</p>
			) : null}
			<Collapsible.Panel>
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
	toolRegistry,
}: {
	tool: ToolInvocation;
	toolRegistry?: ToolRegistry;
}) {
	// A registry entry that claims the tool renders ONLY its rich component —
	// once a genui/terminal card claims the call, the raw tool-call row
	// (wrench + name + Arguments/Raw result disclosure) adds no information
	// the user needs and is dropped entirely, per product requirement.
	// Unclaimed (no match, or every match's render returned null) keeps the
	// plain block.
	const custom = renderFromRegistry(toolRegistry, tool);
	if (custom != null) {
		return <>{custom}</>;
	}
	return <PlainToolView tool={tool} />;
}

function ToolSection({ label, value }: { label: string; value: string }) {
	if (value === "") {
		return null;
	}
	return (
		<div>
			<span className="block px-2 pt-1.5 text-muted-foreground uppercase tracking-wide">
				{label}
			</span>
			<pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-background/60 px-2 py-1.5 font-mono text-muted-foreground">
				{value}
			</pre>
		</div>
	);
}

export function ToolGroup({
	tools,
	toolRegistry,
}: {
	tools: ToolInvocation[];
	toolRegistry?: ToolRegistry;
}) {
	if (tools.length === 0) {
		return null;
	}
	return (
		<div className="flex flex-col gap-2">
			{tools.map((tool) => (
				<ToolInvocationView
					key={tool.callId}
					tool={tool}
					toolRegistry={toolRegistry}
				/>
			))}
		</div>
	);
}
