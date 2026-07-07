import { Button } from "@better-agent/ui/components/button";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@better-agent/ui/components/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { ListToolbar } from "@/components/list/list-toolbar";
import { Pagination } from "@/components/list/pagination";
import { useListView } from "@/components/list/use-list-view";
import type { ProviderCatalogRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";

function matchProvider(row: ProviderCatalogRow, query: string): boolean {
	return (
		row.providerId.toLowerCase().includes(query) ||
		row.name.toLowerCase().includes(query)
	);
}

function CatalogTable({ rows }: { rows: ProviderCatalogRow[] }) {
	if (rows.length === 0) {
		return <p className="text-muted-foreground text-sm">No providers.</p>;
	}
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>Provider</TableHead>
					<TableHead>Name</TableHead>
					<TableHead>npm</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{rows.map((row) => (
					<TableRow key={row.providerId}>
						<TableCell className="font-mono">{row.providerId}</TableCell>
						<TableCell>{row.name}</TableCell>
						<TableCell className="text-muted-foreground">
							{row.npm ?? "—"}
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}

export function CatalogCard() {
	const queryClient = useQueryClient();
	const catalog = useQuery(orpc.providers.catalogList.queryOptions());
	const view = useListView(catalog.data ?? [], { filter: matchProvider });
	const refresh = useMutation(
		orpc.providers.catalogRefresh.mutationOptions({
			onSuccess: () => {
				toast.success("Catalog refreshed");
				queryClient.invalidateQueries({
					queryKey: orpc.providers.catalogList.key(),
				});
			},
			onError: (error) => toast.error(error.message),
		})
	);

	return (
		<div className="flex flex-col gap-3">
			<ListToolbar
				action={
					<Button
						disabled={refresh.isPending}
						onClick={() => refresh.mutate(undefined)}
						size="sm"
					>
						{refresh.isPending ? "Refreshing…" : "Refresh catalog"}
					</Button>
				}
				onSearch={view.setSearch}
				placeholder="Search providers…"
				search={view.search}
			/>
			{catalog.isLoading ? (
				<Skeleton className="h-24 w-full" />
			) : (
				<CatalogTable rows={view.pageRows} />
			)}
			<Pagination
				onPage={view.setPage}
				page={view.page}
				pageCount={view.pageCount}
				total={view.total}
			/>
		</div>
	);
}
