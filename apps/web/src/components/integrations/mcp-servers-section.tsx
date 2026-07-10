import { Badge } from "@better-agent/ui/components/badge";
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

import { DeleteConfirm } from "@/components/list/delete-confirm";
import { ListToolbar } from "@/components/list/list-toolbar";
import { Pagination } from "@/components/list/pagination";
import { type ListView, useListView } from "@/components/list/use-list-view";
import type { McpServerRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";

import { AddMcpServerDialog } from "./add-mcp-server-dialog";
import { EditMcpServerDialog } from "./edit-mcp-server-dialog";
import { IntegrationsEmptyState } from "./empty-state";
import { ExportMcpMenu } from "./export-mcp-menu";
import { McpToolsPreview } from "./mcp-tools-preview";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
	dateStyle: "medium",
});

const ROW_KEYS = ["r1", "r2", "r3"] as const;

function matchServer(row: McpServerRow, query: string): boolean {
	return (
		row.name.toLowerCase().includes(query) ||
		row.url.toLowerCase().includes(query)
	);
}

function useDeleteServer() {
	const queryClient = useQueryClient();
	return useMutation(
		orpc.mcp.deleteServer.mutationOptions({
			onSuccess: () => {
				toast.success("Server removed");
				queryClient.invalidateQueries({
					queryKey: orpc.mcp.listServers.key(),
				});
			},
			onError: (error) => toast.error(error.message),
		})
	);
}

function AuthCell({ authLast4 }: { authLast4: string | null }) {
	if (authLast4 === null) {
		return <Badge variant="secondary">Open</Badge>;
	}
	return (
		<span className="font-mono text-muted-foreground">{`••••${authLast4}`}</span>
	);
}

function ServerRow({
	row,
	onDelete,
}: {
	row: McpServerRow;
	onDelete: (id: string) => void;
}) {
	return (
		<TableRow>
			<TableCell className="font-medium">{row.name}</TableCell>
			<TableCell
				className="max-w-40 truncate font-mono text-muted-foreground"
				title={row.url}
			>
				{row.url}
			</TableCell>
			<TableCell>
				<AuthCell authLast4={row.authLast4} />
			</TableCell>
			<TableCell className="text-muted-foreground">
				{dateFormatter.format(new Date(row.createdAt))}
			</TableCell>
			<TableCell className="text-right">
				<div className="flex items-center justify-end gap-1">
					<McpToolsPreview serverId={row.id} serverName={row.name} />
					<ExportMcpMenu server={row} />
					<EditMcpServerDialog server={row} />
					<DeleteConfirm
						label={`Delete ${row.name}?`}
						onConfirm={() => onDelete(row.id)}
					/>
				</div>
			</TableCell>
		</TableRow>
	);
}

function ServersTable({
	view,
	onDelete,
}: {
	view: ListView<McpServerRow>;
	onDelete: (id: string) => void;
}) {
	return (
		<>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Name</TableHead>
						<TableHead>URL</TableHead>
						<TableHead>Auth</TableHead>
						<TableHead>Created</TableHead>
						<TableHead className="text-right">Actions</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{view.pageRows.map((row) => (
						<ServerRow key={row.id} onDelete={onDelete} row={row} />
					))}
				</TableBody>
			</Table>
			<Pagination
				onPage={view.setPage}
				page={view.page}
				pageCount={view.pageCount}
				total={view.total}
			/>
		</>
	);
}

function ServerRowSkeleton() {
	return (
		<div className="flex items-center gap-4 py-3">
			<Skeleton className="h-4 w-32 flex-1" />
			<Skeleton className="h-4 w-40 flex-1" />
			<Skeleton className="h-4 w-16 flex-1" />
			<Skeleton className="h-4 w-24 flex-1" />
			<Skeleton className="ml-auto size-6 rounded-md" />
		</div>
	);
}

function ServersSkeleton() {
	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center justify-between gap-2">
				<Skeleton className="h-9 w-full max-w-xs" />
				<Skeleton className="h-8 w-28" />
			</div>
			<div className="flex flex-col divide-y">
				{ROW_KEYS.map((key) => (
					<ServerRowSkeleton key={key} />
				))}
			</div>
		</div>
	);
}

export function McpServersSection() {
	const servers = useQuery(orpc.mcp.listServers.queryOptions());
	const rows = servers.data ?? [];
	const view = useListView(rows, { filter: matchServer });
	const remove = useDeleteServer();

	return (
		<div className="flex flex-col gap-3">
			<h2 className="font-medium text-lg">MCP Servers</h2>
			<McpServersBody
				isPending={servers.isPending}
				onDelete={(id) => remove.mutate({ serverId: id })}
				rows={rows}
				view={view}
			/>
		</div>
	);
}

function McpServersBody({
	isPending,
	rows,
	view,
	onDelete,
}: {
	isPending: boolean;
	rows: McpServerRow[];
	view: ListView<McpServerRow>;
	onDelete: (id: string) => void;
}) {
	if (isPending) {
		return <ServersSkeleton />;
	}

	if (rows.length === 0) {
		return (
			<IntegrationsEmptyState
				action={<AddMcpServerDialog />}
				description="Register a remote MCP server (e.g. X's hosted MCP) to give your agents its tools."
				title="No MCP servers yet"
			/>
		);
	}

	return (
		<div className="flex flex-col gap-3">
			<ListToolbar
				action={<AddMcpServerDialog />}
				onSearch={view.setSearch}
				placeholder="Search MCP servers…"
				search={view.search}
			/>
			<ServersTable onDelete={onDelete} view={view} />
		</div>
	);
}
