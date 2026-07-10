import { Button } from "@better-agent/ui/components/button";
import { Input } from "@better-agent/ui/components/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@better-agent/ui/components/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2Icon, SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { DeleteConfirm } from "@/components/list/delete-confirm";
import type { ComposioToolkitRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";

import {
	ConnectKeyDialog,
	type KeyConnectTarget,
	keySchemeFor,
} from "./connect-key-dialog";
import { queryPlaceholder } from "./placeholder";
import { useOauthPopup } from "./use-oauth-popup";

const COLUMN_COUNT = 4;

interface MergedRow {
	connectionId: string | null;
	toolkit: ComposioToolkitRow;
}

function useDisconnect() {
	const queryClient = useQueryClient();
	return useMutation(
		orpc.composio.disconnect.mutationOptions({
			onSuccess: () => {
				toast.success("Disconnected");
				queryClient.invalidateQueries({
					queryKey: orpc.composio.connections.key(),
				});
			},
			onError: (error) => toast.error(error.message),
		})
	);
}

function mergeRows(
	toolkits: ComposioToolkitRow[],
	connectionByToolkit: Map<string, string>
): MergedRow[] {
	return toolkits.map((toolkit) => ({
		toolkit,
		connectionId: connectionByToolkit.get(toolkit.slug.toLowerCase()) ?? null,
	}));
}

function sortRows(rows: MergedRow[]): MergedRow[] {
	return [...rows].sort((a, b) => {
		const aRank = a.connectionId ? 0 : 1;
		const bRank = b.connectionId ? 0 : 1;
		return aRank === bRank
			? a.toolkit.name.localeCompare(b.toolkit.name)
			: aRank - bRank;
	});
}

function filterRows(rows: MergedRow[], search: string): MergedRow[] {
	const term = search.trim().toLowerCase();
	if (!term) {
		return rows;
	}
	return rows.filter(
		(row) =>
			row.toolkit.name.toLowerCase().includes(term) ||
			row.toolkit.slug.toLowerCase().includes(term)
	);
}

// Joins the toolkit catalog with active connections (case-insensitive slug
// match) so the table shows every toolkit exactly once, connected or not.
function useMergedToolkits(accountId: string, search: string) {
	const toolkits = useQuery(
		orpc.composio.toolkits.queryOptions({ input: { accountId } })
	);
	const connections = useQuery(
		orpc.composio.connections.queryOptions({ input: { accountId } })
	);
	const connectionByToolkit = useMemo(() => {
		const map = new Map<string, string>();
		for (const connection of connections.data ?? []) {
			if (connection.active) {
				map.set(connection.toolkitSlug.toLowerCase(), connection.id);
			}
		}
		return map;
	}, [connections.data]);
	const filtered = useMemo(() => {
		const merged = mergeRows(toolkits.data ?? [], connectionByToolkit);
		return sortRows(filterRows(merged, search));
	}, [toolkits.data, connectionByToolkit, search]);
	return { toolkits, filtered };
}

function StatusCell({ connected }: { connected: boolean }) {
	if (!connected) {
		return <span className="text-muted-foreground">—</span>;
	}
	return (
		<span className="inline-flex items-center gap-1">
			<CheckCircle2Icon className="size-4 text-green-600 dark:text-green-500" />
			<span className="sr-only">Connected</span>
		</span>
	);
}

function ToolkitTableRow({
	row,
	isConnecting,
	onConnect,
	onDisconnect,
}: {
	row: MergedRow;
	isConnecting: boolean;
	onConnect: (toolkit: ComposioToolkitRow) => void;
	onDisconnect: (connectionId: string) => void;
}) {
	const { toolkit, connectionId } = row;
	return (
		<TableRow>
			<TableCell className="font-medium">{toolkit.name}</TableCell>
			<TableCell className="font-mono text-muted-foreground">
				{toolkit.slug}
			</TableCell>
			<TableCell>
				<StatusCell connected={connectionId !== null} />
			</TableCell>
			<TableCell className="text-right">
				{connectionId ? (
					<DeleteConfirm
						label={`Disconnect ${toolkit.name}?`}
						onConfirm={() => onDisconnect(connectionId)}
					/>
				) : (
					<Button
						disabled={isConnecting}
						onClick={() => onConnect(toolkit)}
						size="xs"
						variant="outline"
					>
						Connect
					</Button>
				)}
			</TableCell>
		</TableRow>
	);
}

function EmptyRow({ placeholder }: { placeholder: string }) {
	return (
		<TableRow>
			<TableCell
				className="h-20 text-center text-muted-foreground"
				colSpan={COLUMN_COUNT}
			>
				{placeholder}
			</TableCell>
		</TableRow>
	);
}

function ToolkitsTable({
	rows,
	isLoading,
	isConnecting,
	placeholder,
	onConnect,
	onDisconnect,
}: {
	rows: MergedRow[];
	isLoading: boolean;
	isConnecting: boolean;
	placeholder: string;
	onConnect: (toolkit: ComposioToolkitRow) => void;
	onDisconnect: (connectionId: string) => void;
}) {
	return (
		<div className="max-h-96 overflow-auto">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Toolkit</TableHead>
						<TableHead>Slug</TableHead>
						<TableHead>Status</TableHead>
						<TableHead className="text-right">Actions</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{isLoading || rows.length === 0 ? (
						<EmptyRow placeholder={placeholder} />
					) : (
						rows.map((row) => (
							<ToolkitTableRow
								isConnecting={isConnecting}
								key={row.toolkit.slug}
								onConnect={onConnect}
								onDisconnect={onDisconnect}
								row={row}
							/>
						))
					)}
				</TableBody>
			</Table>
		</div>
	);
}

function ToolkitSearch({
	search,
	onSearch,
}: {
	search: string;
	onSearch: (v: string) => void;
}) {
	return (
		<div className="relative">
			<SearchIcon className="absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
			<Input
				aria-label="Search toolkits"
				className="pl-8"
				onChange={(event) => onSearch(event.target.value)}
				placeholder="Search toolkits"
				value={search}
			/>
		</div>
	);
}

/**
 * One merged table: every toolkit in the catalog, connected ones flagged with
 * a green check and a delete action, unconnected ones with a Connect button
 * (OAuth popup or key dialog, routed by `keySchemeFor`). Replaces the old
 * split "authenticated" / "available" sections.
 */
export function ToolkitsSection({ accountId }: { accountId: string }) {
	const [search, setSearch] = useState("");
	const [keyTarget, setKeyTarget] = useState<KeyConnectTarget | null>(null);
	const { toolkits, filtered } = useMergedToolkits(accountId, search);
	const oauth = useOauthPopup(accountId);
	const disconnect = useDisconnect();

	// OAuth toolkits authorize in a small centered popup; key-authenticated ones
	// (tavily etc.) prompt for the service's key — authorize() would error there.
	const handleConnect = (toolkit: ComposioToolkitRow) => {
		const scheme = keySchemeFor(toolkit);
		if (scheme) {
			setKeyTarget({ toolkit, scheme });
		} else {
			oauth.start(toolkit.slug);
		}
	};

	const handleDisconnect = (connectionId: string) => {
		disconnect.mutate({ accountId, connectionId });
	};

	return (
		<div className="flex flex-col gap-2">
			<h2 className="font-medium text-sm">Toolkits</h2>
			<ToolkitSearch onSearch={setSearch} search={search} />
			<ToolkitsTable
				isConnecting={oauth.isPending}
				isLoading={toolkits.isLoading}
				onConnect={handleConnect}
				onDisconnect={handleDisconnect}
				placeholder={queryPlaceholder(toolkits, "No toolkits found.")}
				rows={filtered}
			/>
			<ConnectKeyDialog
				accountId={accountId}
				onClose={() => setKeyTarget(null)}
				target={keyTarget}
			/>
		</div>
	);
}
