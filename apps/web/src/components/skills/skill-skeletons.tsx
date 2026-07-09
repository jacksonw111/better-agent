import { Skeleton } from "@better-agent/ui/components/skeleton";

const LIST_ROW_KEYS = ["r1", "r2", "r3"] as const;

/** Loading placeholder for the skills list: row-shaped skeletons (mirrors
 * MemoryListSkeleton). */
export function SkillListSkeleton() {
	return (
		<div className="flex flex-col gap-2">
			{LIST_ROW_KEYS.map((key) => (
				<div
					className="flex items-center justify-between gap-3 rounded-xl border p-4"
					key={key}
				>
					<div className="flex min-w-0 flex-1 flex-col gap-1.5">
						<Skeleton className="h-4 w-32" />
						<Skeleton className="h-3 w-48" />
					</div>
					<Skeleton className="h-5 w-20 rounded-md" />
				</div>
			))}
		</div>
	);
}
