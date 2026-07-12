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
import type { ComposioAccountRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";

import { AddAccountDialog } from "./add-account-dialog";
import { AccountsSkeleton } from "./integrations-skeleton";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
	dateStyle: "medium",
});

function matchAccount(row: ComposioAccountRow, query: string): boolean {
	return row.name.toLowerCase().includes(query);
}

function useDeleteAccount() {
	const queryClient = useQueryClient();
	return useMutation(
		orpc.composio.deleteAccount.mutationOptions({
			onSuccess: () => {
				toast.success("Account removed");
				queryClient.invalidateQueries({
					queryKey: orpc.composio.listAccounts.key(),
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
	row: ComposioAccountRow;
	onDelete: (id: string) => void;
}) {
	return (
		<TableRow>
			<TableCell className="font-medium">
				<Link
					className="hover:underline"
					params={{ accountId: row.id }}
					to="/integrations/$accountId"
				>
					{row.name}
				</Link>
			</TableCell>
			<TableCell className="font-mono text-muted-foreground">
				{`••••${row.apiKeyLast4}`}
			</TableCell>
			<TableCell className="text-muted-foreground">
				{dateFormatter.format(new Date(row.createdAt))}
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
	view: ListView<ComposioAccountRow>;
	onDelete: (id: string) => void;
}) {
	return (
		<>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Name</TableHead>
						<TableHead>API key</TableHead>
						<TableHead>Created</TableHead>
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

export function AccountsList() {
	const accounts = useQuery(orpc.composio.listAccounts.queryOptions());
	const rows = accounts.data ?? [];
	const view = useListView(rows, { filter: matchAccount });
	const remove = useDeleteAccount();

	if (accounts.isPending) {
		return <AccountsSkeleton />;
	}

	if (rows.length === 0) {
		return (
			<EmptyState
				action={<AddAccountDialog />}
				body="Add a Composio account with your API key to start connecting tools like Gmail, Slack, or Notion to your agents."
				icon={PlugIcon}
				title="No integrations yet"
			/>
		);
	}

	return (
		<div className="flex flex-col gap-3">
			<ListToolbar
				action={<AddAccountDialog />}
				onSearch={view.setSearch}
				placeholder="Search integrations…"
				search={view.search}
			/>
			<AccountsTable
				onDelete={(id) => remove.mutate({ accountId: id })}
				view={view}
			/>
		</div>
	);
}
