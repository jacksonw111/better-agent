import { Skeleton } from "@better-agent/ui/components/skeleton";

const ROW_KEYS = ["a", "b", "c", "d", "e"];

export function KnowledgeListSkeleton() {
	return (
		<div className="flex flex-col gap-2">
			<Skeleton className="h-3 w-16" />
			{ROW_KEYS.map((key) => (
				<Skeleton className="h-11 w-full rounded-lg" key={key} />
			))}
		</div>
	);
}
