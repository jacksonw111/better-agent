import { Skeleton } from "@better-agent/ui/components/skeleton";

const ROW_KEYS = ["r1", "r2", "r3"] as const;

/** Loading placeholder for a Profile tab: an intro line plus a few row-shaped
 * skeletons, matching the eventual list layout. */
export function ProfileSectionSkeleton() {
	return (
		<div className="flex flex-col gap-4">
			<Skeleton className="h-4 w-96 max-w-full" />
			<div className="flex flex-col gap-2">
				{ROW_KEYS.map((key) => (
					<div
						className="flex items-center justify-between gap-3 rounded-xl bg-muted/40 p-3"
						key={key}
					>
						<div className="flex min-w-0 flex-1 flex-col gap-1.5">
							<Skeleton className="h-4 w-40" />
							<Skeleton className="h-3 w-64 max-w-full" />
						</div>
						<Skeleton className="h-5 w-9 rounded-full" />
					</div>
				))}
			</div>
		</div>
	);
}
