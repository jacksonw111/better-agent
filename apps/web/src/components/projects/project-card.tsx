import { Button } from "@better-agent/ui/components/button";
import { cn } from "@better-agent/ui/lib/utils";
import { RefreshCwIcon } from "lucide-react";
import type { ProjectStatus } from "./project-status-chip";

// Q3: the shared shell for the project detail's Git/Files cards — a tinted
// section (no borders) with a title row and an optional refresh action —
// plus the one gate both cards share: no live query while the checkout can't
// be read (clone pending/failed, or the computer offline). The gate returns
// the EXPLANATION so neither card ever renders blank.

/** Why the card can't query the checkout right now, or null when it can. */
export function unavailableReason(
	status: ProjectStatus,
	online: boolean
): string | null {
	if (status === "error") {
		return "The clone failed — fix the repository or token and create the project again.";
	}
	if (status !== "ready") {
		return "The repository is still being cloned — this card fills in once the project is ready.";
	}
	if (!online) {
		return "This computer is offline — reconnect it to browse the checkout.";
	}
	return null;
}

export function CardNotice({ text }: { text: string }) {
	return <p className="text-muted-foreground text-sm">{text}</p>;
}

export function ProjectCard({
	children,
	onRefresh,
	refreshing = false,
	title,
}: {
	children: React.ReactNode;
	onRefresh?: () => void;
	refreshing?: boolean;
	title: string;
}) {
	return (
		<section className="flex min-w-0 flex-col gap-3 rounded-xl bg-muted/40 p-4">
			<div className="flex items-center justify-between">
				<h2 className="font-medium text-sm">{title}</h2>
				{onRefresh && (
					<Button
						aria-label={`Refresh ${title}`}
						className="text-muted-foreground"
						disabled={refreshing}
						onClick={onRefresh}
						size="icon-sm"
						variant="ghost"
					>
						<RefreshCwIcon
							className={cn("size-4", refreshing && "animate-spin")}
						/>
					</Button>
				)}
			</div>
			{children}
		</section>
	);
}
