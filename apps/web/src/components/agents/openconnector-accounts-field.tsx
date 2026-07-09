import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@better-agent/ui/components/select";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import type { OpenConnectorAccountRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";

// An agent links at most ONE OpenConnector account. Stored as a string[] (0 or
// 1 items) so the backend stays uniform, but the UI is a single-select.
const NONE = "none";

function NoAccountsHint() {
	return (
		<p className="text-muted-foreground text-sm">
			No OpenConnector accounts yet.{" "}
			<Link
				className="underline hover:text-foreground"
				search={{ tab: "openconnector" }}
				to="/integrations"
			>
				Add one in Integrations
			</Link>{" "}
			to link tools.
		</p>
	);
}

function AccountSelect({
	rows,
	selected,
	onChange,
}: {
	rows: OpenConnectorAccountRow[];
	selected: string[];
	onChange: (ids: string[]) => void;
}) {
	// Map each value to its display label so the trigger shows the account name,
	// not the raw UUID.
	const items: Record<string, string> = {
		[NONE]: "No OpenConnector account",
		...Object.fromEntries(rows.map((row) => [row.id, row.name])),
	};
	return (
		<Select
			items={items}
			onValueChange={(next) => {
				const value = typeof next === "string" ? next : NONE;
				onChange(value === NONE ? [] : [value]);
			}}
			value={selected[0] ?? NONE}
		>
			<SelectTrigger className="w-full" id="agent-openconnector">
				<SelectValue placeholder="No OpenConnector account" />
			</SelectTrigger>
			<SelectContent>
				<SelectItem value={NONE}>None</SelectItem>
				{rows.map((row) => (
					<SelectItem key={row.id} value={row.id}>
						{row.name}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

export function OpenConnectorAccountsField({
	selected,
	onChange,
}: {
	selected: string[];
	onChange: (ids: string[]) => void;
}) {
	const accounts = useQuery(orpc.openConnector.listAccounts.queryOptions());
	const rows = accounts.data ?? [];

	if (rows.length === 0) {
		return <NoAccountsHint />;
	}

	return <AccountSelect onChange={onChange} rows={rows} selected={selected} />;
}
