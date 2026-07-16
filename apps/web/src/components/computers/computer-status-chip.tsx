import { Badge } from "@better-agent/ui/components/badge";
import { cn } from "@better-agent/ui/lib/utils";

/** Connected/Offline pill, styled after LocalAgentStatusChip so the two
 * lists read the same. Offline computers stay listed — this only recolors.
 * Shared by the Computers list and the New Task wizard's computer choices. */
export function ComputerStatusChip({ connected }: { connected: boolean }) {
	return (
		<Badge className="gap-1.5" variant={connected ? "outline" : "secondary"}>
			<span
				aria-hidden
				className={cn(
					"size-1.5 rounded-full",
					connected ? "bg-emerald-500" : "bg-muted-foreground/30"
				)}
			/>
			{connected ? "Connected" : "Offline"}
		</Badge>
	);
}
