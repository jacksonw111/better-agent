import { Skeleton } from "@better-agent/ui/components/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@better-agent/ui/components/table";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { ListToolbar } from "@/components/list/list-toolbar";
import { Pagination } from "@/components/list/pagination";
import { useListView } from "@/components/list/use-list-view";
import type { ModelRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";
import { ProviderSelect } from "./provider-select";

function matchModel(row: ModelRow, query: string): boolean {
	return (
		row.modelId.toLowerCase().includes(query) ||
		row.name.toLowerCase().includes(query)
	);
}

function ModelsTable({ rows }: { rows: ModelRow[] }) {
	if (rows.length === 0) {
		return <p className="text-muted-foreground text-sm">No models.</p>;
	}
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>Model</TableHead>
					<TableHead>Name</TableHead>
					<TableHead>Context</TableHead>
					<TableHead>Tools</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{rows.map((row) => (
					<TableRow key={row.modelId}>
						<TableCell className="font-mono">{row.modelId}</TableCell>
						<TableCell>{row.name}</TableCell>
						<TableCell className="text-muted-foreground">
							{row.contextLimit ?? "—"}
						</TableCell>
						<TableCell className="text-muted-foreground">
							{row.capabilities.toolCall ? "yes" : "no"}
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}

export function ModelsCard() {
	const [providerId, setProviderId] = useState("");
	const catalog = useQuery(orpc.providers.catalogList.queryOptions());
	const models = useQuery(
		orpc.providers.modelsList.queryOptions({
			input: { providerId },
			enabled: providerId !== "",
		})
	);
	const view = useListView(models.data ?? [], { filter: matchModel });

	return (
		<div className="flex flex-col gap-3">
			<ListToolbar
				action={
					<ProviderSelect
						ariaLabel="Provider"
						onChange={setProviderId}
						placeholder="Select a provider…"
						providers={catalog.data ?? []}
						value={providerId}
					/>
				}
				onSearch={view.setSearch}
				placeholder="Search models…"
				search={view.search}
			/>
			{providerId === "" ? (
				<p className="text-muted-foreground text-sm">
					Pick a provider to list its models.
				</p>
			) : (
				<>
					{models.isLoading ? (
						<Skeleton className="h-24 w-full" />
					) : (
						<ModelsTable rows={view.pageRows} />
					)}
					<Pagination
						onPage={view.setPage}
						page={view.page}
						pageCount={view.pageCount}
						total={view.total}
					/>
				</>
			)}
		</div>
	);
}
