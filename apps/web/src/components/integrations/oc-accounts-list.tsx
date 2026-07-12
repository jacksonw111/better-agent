import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@better-agent/ui/components/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { PlugIcon } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/layout/empty-state";
import { DeleteConfirm } from "@/components/list/delete-confirm";
import { ListToolbar } from "@/components/list/list-toolbar";
import { Pagination } from "@/components/list/pagination";
import { type ListView, useListView } from "@/components/list/use-list-view";
import type { OpenConnectorAccountRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";
import { AccountsSkeleton } from "./integrations-skeleton";
import { OcAddAccountDialog } from "./oc-add-account-dialog";

function matchAccount(row: OpenConnectorAccountRow, query: string): boolean {
	return (
		row.name.toLowerCase().includes(query) ||
		row.baseUrl.toLowerCase().includes(query)
	);
}

function useDeleteAccount() {
	const queryClient = useQueryClient();
	return useMutation(
		orpc.openConnector.deleteAccount.mutationOptions({
			onSuccess: () => {
				toast.success("Account removed");
				queryClient.invalidateQueries({
					queryKey: orpc.openConnector.listAccounts.key(),
				});
			},
			onError: (error) => toast.error(error.message),
		})
	);
}

function AccountRow({
	row,
	onDelete,
}: {
	row: OpenConnectorAccountRow;
	onDelete: (id: string) => void;
}) {
	return (
		<TableRow>
			<TableCell className="font-medium">
				<Link
					className="hover:underline"
					params={{ accountId: row.id }}
					to="/integrations/oc/$accountId"
				>
					{row.name}
				</Link>
			</TableCell>
			<TableCell className="max-w-xs truncate font-mono text-muted-foreground">
				{row.baseUrl}
			</TableCell>
			<TableCell className="font-mono text-muted-foreground">
				{`••••${row.runtimeTokenLast4}`}
			</TableCell>
			<TableCell className="text-right">
				<DeleteConfirm
					label={`Delete ${row.name}?`}
					onConfirm={() => onDelete(row.id)}
				/>
			</TableCell>
		</TableRow>
	);
}

function AccountsTable({
	view,
	onDelete,
}: {
	view: ListView<OpenConnectorAccountRow>;
	onDelete: (id: string) => void;
}) {
	return (
		<>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Name</TableHead>
						<TableHead>Base URL</TableHead>
						<TableHead>Runtime token</TableHead>
						<TableHead className="text-right">Actions</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{view.pageRows.map((row) => (
						<AccountRow key={row.id} onDelete={onDelete} row={row} />
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

export function OcAccountsList() {
	const accounts = useQuery(orpc.openConnector.listAccounts.queryOptions());
	const rows = accounts.data ?? [];
	const view = useListView(rows, { filter: matchAccount });
	const remove = useDeleteAccount();

	if (accounts.isPending) {
		return <AccountsSkeleton />;
	}

	if (rows.length === 0) {
		return (
			<EmptyState
				action={<OcAddAccountDialog />}
				body="Add an OpenConnector account with your instance URL and tokens to connect provider tools to your agents."
				icon={PlugIcon}
				title="No OpenConnector accounts yet"
			/>
		);
	}

	return (
		<div className="flex flex-col gap-3">
			<ListToolbar
				action={<OcAddAccountDialog />}
				onSearch={view.setSearch}
				placeholder="Search accounts…"
				search={view.search}
			/>
			<AccountsTable
				onDelete={(id) => remove.mutate({ accountId: id })}
				view={view}
			/>
		</div>
	);
}
