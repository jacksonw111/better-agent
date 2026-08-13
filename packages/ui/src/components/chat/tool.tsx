import { Collapsible } from "@base-ui/react/collapsible";
import { ChevronDownIcon, WrenchIcon } from "lucide-react";
import type { ToolInvocation } from "./chat-blocks";
import { renderFromRegistry, type ToolRegistry } from "./tool-registry";
import { ToolStatusIcon } from "./tool-status-icon";

const MAX_VALUE_CHARS = 2000;
const MAX_CHIP_CHARS = 120;

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

/** One-line argument summary for the collapsed row's chip — `{"q":"nvda"}`
 * style, truncated hard so the row never wraps. */
function chipText(args: unknown): string {
	if (args === undefined || args === null) {
		return "";
	}
	let text: string;
	try {
		text = typeof args === "string" ? args : JSON.stringify(args);
	} catch {
		text = String(args);
	}
	const oneLine = text.replace(/\s+/g, " ").trim();
	return oneLine.length > MAX_CHIP_CHARS
		? `${oneLine.slice(0, MAX_CHIP_CHARS)}…`
		: oneLine;
}

// The plain (unregistered / errored / in-flight) tool block, styled after
// beautifului.dev's tool-chips: a transparent hover row — tool icon, name,
// a tinted mono chip summarizing the arguments, status — expanding to a
// rail-indented detail with the raw arguments and result. No card border or
// ring anywhere (product rule for tool rendering).
function ToolRowHeader({ tool }: { tool: ToolInvocation }) {
	const chip = chipText(tool.args);
	return (
		<Collapsible.Trigger className="group -mx-1 flex h-7 w-[calc(100%_+_8px)] min-w-0 items-center gap-2 rounded-lg px-1 text-left transition-colors duration-100 hover:bg-accent">
			<span className="relative flex size-4 shrink-0 items-center justify-center text-muted-foreground">
				<WrenchIcon className="size-3.5 transition-opacity duration-100 group-hover:opacity-0 group-data-[panel-open]:opacity-0" />
				<ChevronDownIcon className="absolute size-3.5 -rotate-90 opacity-0 transition-[opacity,_transform] duration-150 group-hover:opacity-100 group-data-[panel-open]:rotate-0 group-data-[panel-open]:opacity-100" />
			</span>
			<span className="shrink-0 font-medium font-mono text-foreground text-xs">
				{tool.toolName}
			</span>
			{chip === "" ? null : (
				<span className="inline-flex h-5 min-w-0 flex-1 items-center truncate rounded-md bg-muted px-1.5 font-mono text-muted-foreground text-xs">
					{chip}
				</span>
			)}
			<span className="ml-auto shrink-0">
				<ToolStatusIcon status={tool.status} />
			</span>
		</Collapsible.Trigger>
	);
}

function PlainToolView({ tool }: { tool: ToolInvocation }) {
	return (
		<Collapsible.Root
			className="flex w-full flex-col text-xs"
			defaultOpen={tool.isError}
		>
			<ToolRowHeader tool={tool} />
			{tool.isError ? (
				<p className="mt-1 ml-2 break-words border-border border-l py-0.5 pl-4 text-destructive">
					{formatValue(tool.result) || "Tool call failed."}
				</p>
			) : null}
			<Collapsible.Panel className="mt-0.5 mb-1 ml-2 flex flex-col gap-1 border-border border-l py-0.5 pl-4">
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
	// once a genui card claims the call, the raw tool-call row (wrench + name
	// + Arguments/Raw result disclosure) adds no information the user needs
	// and is dropped entirely, per product requirement. Unclaimed (no match,
	// or every match's render returned null) keeps the plain block.
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
			<span className="block text-muted-foreground/80 text-xs uppercase tracking-wide">
				{label}
			</span>
			<pre className="overflow-x-auto whitespace-pre-wrap break-words py-0.5 font-mono text-muted-foreground text-xs leading-relaxed">
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
		<div className="flex flex-col gap-1">
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
