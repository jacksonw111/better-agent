import { useNavigate } from "@tanstack/react-router";
import { BookMarkedIcon } from "lucide-react";
import type { MemoryRow } from "./memory-types";

/** The memory identity block shared by the table row and the mobile card:
 * its NAME is the only navigation target, so both views navigate identically
 * and can't drift. */
export function MemoryIdentity({ memory }: { memory: MemoryRow }) {
	const navigate = useNavigate();
	return (
		<div className="flex min-w-0 items-center gap-2">
			<BookMarkedIcon className="size-4 shrink-0 text-muted-foreground" />
			<button
				className="truncate text-left font-medium hover:underline"
				onClick={() =>
					navigate({
						params: { memoryId: memory.id },
						to: "/memories/$memoryId",
					})
				}
				type="button"
			>
				{memory.name}
			</button>
		</div>
	);
}
