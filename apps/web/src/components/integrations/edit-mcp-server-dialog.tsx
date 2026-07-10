import { Button } from "@better-agent/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@better-agent/ui/components/dialog";
import { Input } from "@better-agent/ui/components/input";
import { Label } from "@better-agent/ui/components/label";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PencilIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { McpServerRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";
import { NameUrlFields } from "./add-mcp-server-dialog";

function useUpdateServer(onDone: () => void) {
	const queryClient = useQueryClient();
	return useMutation(
		orpc.mcp.updateServer.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.mcp.listServers.key(),
				});
				toast.success("Server updated");
				onDone();
			},
			onError: (error) => toast.error(error.message),
		})
	);
}

function ClearedTokenField({ onUndoClear }: { onUndoClear: () => void }) {
	return (
		<div className="flex flex-col gap-1">
			<Label>Bearer token (optional)</Label>
			<div className="flex items-center justify-between rounded-md border border-dashed px-3 py-2 text-muted-foreground text-sm">
				<span>Token will be removed</span>
				<Button onClick={onUndoClear} size="xs" type="button" variant="ghost">
					Undo
				</Button>
			</div>
		</div>
	);
}

function TokenEditField({
	authLast4,
	bearerToken,
	cleared,
	onClear,
	onToken,
	onUndoClear,
}: {
	authLast4: string | null;
	bearerToken: string;
	cleared: boolean;
	onClear: () => void;
	onToken: (v: string) => void;
	onUndoClear: () => void;
}) {
	const hasToken = authLast4 !== null;

	if (cleared) {
		return <ClearedTokenField onUndoClear={onUndoClear} />;
	}

	return (
		<div className="flex flex-col gap-1">
			<Label htmlFor="mcp-edit-token">Bearer token (optional)</Label>
			<Input
				autoComplete="off"
				id="mcp-edit-token"
				onChange={(event) => onToken(event.target.value)}
				placeholder={hasToken ? `Unchanged (••••${authLast4})` : "Bearer token"}
				type="password"
				value={bearerToken}
			/>
			<p className="text-muted-foreground text-xs">
				{hasToken
					? "Leave empty to keep the current token."
					: "Sent as the Authorization header. Leave empty for open servers."}
			</p>
			{hasToken ? (
				<Button
					className="h-auto self-start px-0 text-destructive"
					onClick={onClear}
					size="xs"
					type="button"
					variant="link"
				>
					Remove token
				</Button>
			) : null}
		</div>
	);
}

/** `bearerToken` sent to the mutation: `undefined` (unchanged) when the field
 * was left blank, `null` (clear) when the owner explicitly removed it,
 * otherwise the new value. */
function bearerTokenPatch(
	tokenCleared: boolean,
	bearerToken: string
): string | null | undefined {
	if (tokenCleared) {
		return null;
	}
	return bearerToken.trim() === "" ? undefined : bearerToken;
}

function EditServerForm({
	onSaved,
	server,
}: {
	onSaved: () => void;
	server: McpServerRow;
}) {
	const [name, setName] = useState(server.name);
	const [url, setUrl] = useState(server.url);
	const [bearerToken, setBearerToken] = useState("");
	const [tokenCleared, setTokenCleared] = useState(false);
	const update = useUpdateServer(onSaved);

	return (
		<form
			className="flex flex-col gap-3"
			onSubmit={(event) => {
				event.preventDefault();
				update.mutate({
					serverId: server.id,
					name,
					url,
					bearerToken: bearerTokenPatch(tokenCleared, bearerToken),
				});
			}}
		>
			<NameUrlFields name={name} onName={setName} onUrl={setUrl} url={url} />
			<TokenEditField
				authLast4={server.authLast4}
				bearerToken={bearerToken}
				cleared={tokenCleared}
				onClear={() => {
					setTokenCleared(true);
					setBearerToken("");
				}}
				onToken={setBearerToken}
				onUndoClear={() => setTokenCleared(false)}
			/>
			<Button className="self-end" disabled={update.isPending} type="submit">
				{update.isPending ? "Saving…" : "Save changes"}
			</Button>
		</form>
	);
}

export function EditMcpServerDialog({ server }: { server: McpServerRow }) {
	const [open, setOpen] = useState(false);
	return (
		<Dialog onOpenChange={setOpen} open={open}>
			<DialogTrigger
				render={
					<Button
						aria-label="Edit server"
						size="icon-xs"
						title="Edit server"
						variant="ghost"
					/>
				}
			>
				<PencilIcon className="size-4" />
			</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Edit MCP server</DialogTitle>
				</DialogHeader>
				{open ? (
					<EditServerForm onSaved={() => setOpen(false)} server={server} />
				) : null}
			</DialogContent>
		</Dialog>
	);
}
