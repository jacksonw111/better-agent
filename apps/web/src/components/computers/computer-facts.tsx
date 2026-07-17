import { cn } from "@better-agent/ui/lib/utils";
import type { ComputerListItem } from "@/utils/api-types";

// Small read-only facts shared by the Computers list cards and the Computer
// detail page, so the two surfaces can't drift in wording or emphasis.

/** "darwin · arm64 · Client 0.3.0" — whichever parts the computer reported. */
export function computerMeta(computer: ComputerListItem): string {
	const version =
		computer.clientVersion === null ? null : `Client ${computer.clientVersion}`;
	return [computer.platform, computer.arch, version]
		.filter((part) => part !== null)
		.join(" · ");
}

/** git/gh presence facts. Deliberately quiet copy — "installed"/"missing" is
 * a PATH observation, never an authentication or health promise. */
export function ToolFacts({
	tools,
}: {
	tools: ComputerListItem["toolInventory"];
}) {
	if (tools.length === 0) {
		return null;
	}
	return (
		<div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground text-xs">
			{tools.map((tool) => (
				<span className={cn(!tool.installed && "opacity-70")} key={tool.name}>
					{tool.name} {tool.installed ? "installed" : "missing"}
				</span>
			))}
		</div>
	);
}
