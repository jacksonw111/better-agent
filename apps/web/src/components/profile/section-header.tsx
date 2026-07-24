import { Button } from "@better-agent/ui/components/button";
import { PlusIcon } from "lucide-react";

/** Shared header for the Standards/Templates tabs: an intro line on the left
 * and a "New …" button on the right. */
export function SectionHeader({
	intro,
	createLabel,
	onCreate,
}: {
	intro: string;
	createLabel: string;
	onCreate: () => void;
}) {
	return (
		<div className="flex items-start justify-between gap-4">
			<p className="max-w-2xl text-muted-foreground text-sm">{intro}</p>
			<Button onClick={onCreate} size="sm">
				<PlusIcon />
				{createLabel}
			</Button>
		</div>
	);
}
