import { Skeleton } from "@better-agent/ui/components/skeleton";

const LIST_ROW_KEYS = ["r1", "r2", "r3"] as const;
const ITEM_ROW_KEYS = ["i1", "i2"] as const;

/** Loading placeholder for the memories list: row-shaped skeletons. */
export function MemoryListSkeleton() {
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

/** Loading placeholder for the memory detail page: header + a few items. */
export function MemoryDetailSkeleton() {
	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-1.5">
				<Skeleton className="h-5 w-40" />
				<Skeleton className="h-3 w-56" />
			</div>
			<Skeleton className="h-24 w-full rounded-lg" />
			{ITEM_ROW_KEYS.map((key) => (
				<div className="flex flex-col gap-2 rounded-lg border p-4" key={key}>
					<Skeleton className="h-4 w-full" />
					<Skeleton className="h-3 w-40" />
				</div>
			))}
		</div>
	);
}
