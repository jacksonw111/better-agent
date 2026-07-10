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
import type { OpenConnectorProviderRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";

import { OcConnectKeyDialog } from "./oc-connect-key-dialog";
import { queryPlaceholder } from "./placeholder";

const COLUMN_COUNT = 3;

// Auth types the API-key connect flow can handle. Providers offering none of
// these (only oauth2) are disabled until the OAuth flow ships.
const KEY_AUTH_TYPES = new Set(["api_key", "custom_credential", "no_auth"]);

interface MergedRow {
	connected: boolean;
	provider: OpenConnectorProviderRow;
}

function canKeyConnect(provider: OpenConnectorProviderRow): boolean {
	return provider.authTypes.some((type) => KEY_AUTH_TYPES.has(type));
}

function useDisconnect() {
	const queryClient = useQueryClient();
	return useMutation(
		orpc.openConnector.disconnect.mutationOptions({
			onSuccess: () => {
				toast.success("Disconnected");
				queryClient.invalidateQueries({
					queryKey: orpc.openConnector.connections.key(),
				});
			},
			onError: (error) => toast.error(error.message),
		})
	);
}

function mergeRows(
	providers: OpenConnectorProviderRow[],
	connectedServices: Set<string>
): MergedRow[] {
	return providers.map((provider) => ({
		provider,
		connected: connectedServices.has(provider.service.toLowerCase()),
	}));
}

function sortRows(rows: MergedRow[]): MergedRow[] {
	return [...rows].sort((a, b) => {
		const rank = Number(b.connected) - Number(a.connected);
		return rank === 0
			? a.provider.displayName.localeCompare(b.provider.displayName)
			: rank;
	});
}

function filterRows(rows: MergedRow[], search: string): MergedRow[] {
	const term = search.trim().toLowerCase();
	if (!term) {
		return rows;
	}
	return rows.filter(
		(row) =>
			row.provider.displayName.toLowerCase().includes(term) ||
			row.provider.service.toLowerCase().includes(term)
	);
}

// Joins the provider catalog with active connections (a connection counts only
// when configured and non-virtual) so each provider shows once, connected or not.
function useMergedProviders(accountId: string, search: string) {
	const providers = useQuery(
		orpc.openConnector.providers.queryOptions({ input: { accountId } })
	);
	const connections = useQuery(
		orpc.openConnector.connections.queryOptions({ input: { accountId } })
	);
	const connectedServices = useMemo(() => {
		const set = new Set<string>();
		for (const connection of connections.data ?? []) {
			if (connection.configured && !connection.virtual) {
				set.add(connection.service.toLowerCase());
			}
		}
		return set;
	}, [connections.data]);
	const filtered = useMemo(() => {
		const merged = mergeRows(providers.data ?? [], connectedServices);
		return sortRows(filterRows(merged, search));
	}, [providers.data, connectedServices, search]);
	return { providers, filtered };
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

function RowAction({
	row,
	onConnect,
	onDisconnect,
}: {
	row: MergedRow;
	onConnect: (provider: OpenConnectorProviderRow) => void;
	onDisconnect: (service: string) => void;
}) {
	if (row.connected) {
		return (
			<DeleteConfirm
				label={`Disconnect ${row.provider.displayName}?`}
				onConfirm={() => onDisconnect(row.provider.service)}
			/>
		);
	}
	if (!canKeyConnect(row.provider)) {
		return (
			<Button disabled size="xs" variant="outline">
				OAuth (coming soon)
			</Button>
		);
	}
	return (
		<Button onClick={() => onConnect(row.provider)} size="xs" variant="outline">
			Connect
		</Button>
	);
}

function ProviderTableRow({
	row,
	onConnect,
	onDisconnect,
}: {
	row: MergedRow;
	onConnect: (provider: OpenConnectorProviderRow) => void;
	onDisconnect: (service: string) => void;
}) {
	return (
		<TableRow>
			<TableCell className="font-medium">{row.provider.displayName}</TableCell>
			<TableCell>
				<StatusCell connected={row.connected} />
			</TableCell>
			<TableCell className="text-right">
				<RowAction
					onConnect={onConnect}
					onDisconnect={onDisconnect}
					row={row}
				/>
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

function ProvidersTable({
	rows,
	isLoading,
	placeholder,
	onConnect,
	onDisconnect,
}: {
	rows: MergedRow[];
	isLoading: boolean;
	placeholder: string;
	onConnect: (provider: OpenConnectorProviderRow) => void;
	onDisconnect: (service: string) => void;
}) {
	return (
		<div className="max-h-96 overflow-auto">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Provider</TableHead>
						<TableHead>Status</TableHead>
						<TableHead className="text-right">Actions</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{isLoading || rows.length === 0 ? (
						<EmptyRow placeholder={placeholder} />
					) : (
						rows.map((row) => (
							<ProviderTableRow
								key={row.provider.service}
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

function ProviderSearch({
	search,
	onSearch,
}: {
	search: string;
	onSearch: (value: string) => void;
}) {
	return (
		<div className="relative">
			<SearchIcon className="absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
			<Input
				aria-label="Search providers"
				className="pl-8"
				onChange={(event) => onSearch(event.target.value)}
				placeholder="Search providers"
				value={search}
			/>
		</div>
	);
}

/**
 * One merged table of the OpenConnector provider catalog: connected providers
 * get a green check and a Disconnect action, key-authenticatable ones a Connect
 * button, and OAuth-only providers a disabled "coming soon" state (v1 supports
 * API-key connect only).
 */
export function OcProvidersSection({ accountId }: { accountId: string }) {
	const [search, setSearch] = useState("");
	const [keyTarget, setKeyTarget] = useState<OpenConnectorProviderRow | null>(
		null
	);
	const { providers, filtered } = useMergedProviders(accountId, search);
	const disconnect = useDisconnect();

	return (
		<div className="flex flex-col gap-2">
			<h2 className="font-medium text-sm">Providers</h2>
			<ProviderSearch onSearch={setSearch} search={search} />
			<ProvidersTable
				isLoading={providers.isLoading}
				onConnect={setKeyTarget}
				onDisconnect={(service) => disconnect.mutate({ accountId, service })}
				placeholder={queryPlaceholder(providers, "No providers found.")}
				rows={filtered}
			/>
			<OcConnectKeyDialog
				accountId={accountId}
				onClose={() => setKeyTarget(null)}
				provider={keyTarget}
			/>
		</div>
	);
}
