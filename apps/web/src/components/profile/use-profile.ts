import { useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "@/utils/orpc";

/** The single source both the Standards and Templates sections read from —
 * `profiles.get` returns the version plus the full standards/templates lists,
 * so one query backs the whole Profile area. */
export function useProfile() {
	return useQuery(orpc.profiles.get.queryOptions());
}

/** Invalidator every profile mutation calls on success: any write bumps the
 * server-side version, so the whole envelope must be refetched. */
export function useInvalidateProfile() {
	const queryClient = useQueryClient();
	return () =>
		queryClient.invalidateQueries({ queryKey: orpc.profiles.get.key() });
}
