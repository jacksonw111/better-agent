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
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { celebrateSuccess } from "@/utils/celebrate";
import { orpc } from "@/utils/orpc";

function useCreateServer(onDone: () => void) {
	const queryClient = useQueryClient();
	return useMutation(
		orpc.mcp.createServer.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.mcp.listServers.key(),
				});
				celebrateSuccess("MCP server added");
				onDone();
			},
			onError: (error) => toast.error(error.message),
		})
	);
}

export function NameUrlFields({
	name,
	url,
	onName,
	onUrl,
}: {
	name: string;
	url: string;
	onName: (v: string) => void;
	onUrl: (v: string) => void;
}) {
	return (
		<>
			<div className="flex flex-col gap-1">
				<Label htmlFor="mcp-name">Name</Label>
				<Input
					id="mcp-name"
					onChange={(event) => onName(event.target.value)}
					placeholder="e.g. My tools server"
					required
					value={name}
				/>
			</div>
			<div className="flex flex-col gap-1">
				<Label htmlFor="mcp-url">URL</Label>
				<Input
					id="mcp-url"
					onChange={(event) => onUrl(event.target.value)}
					placeholder="https://example.com/mcp"
					required
					type="url"
					value={url}
				/>
				<p className="text-muted-foreground text-xs">
					A remote MCP server over Streamable HTTP.
				</p>
			</div>
		</>
	);
}

function TokenField({
	bearerToken,
	onToken,
}: {
	bearerToken: string;
	onToken: (v: string) => void;
}) {
	return (
		<div className="flex flex-col gap-1">
			<Label htmlFor="mcp-token">Bearer token (optional)</Label>
			<Input
				autoComplete="off"
				id="mcp-token"
				onChange={(event) => onToken(event.target.value)}
				placeholder="Bearer token"
				type="password"
				value={bearerToken}
			/>
			<p className="text-muted-foreground text-xs">
				Sent as the Authorization header. Leave empty for open servers.
			</p>
		</div>
	);
}

function ServerForm({ onCreated }: { onCreated: () => void }) {
	const [name, setName] = useState("");
	const [url, setUrl] = useState("");
	const [bearerToken, setBearerToken] = useState("");
	const create = useCreateServer(onCreated);

	return (
		<form
			className="flex flex-col gap-3"
			onSubmit={(event) => {
				event.preventDefault();
				create.mutate({
					name,
					url,
					bearerToken: bearerToken.trim() === "" ? undefined : bearerToken,
				});
			}}
		>
			<NameUrlFields name={name} onName={setName} onUrl={setUrl} url={url} />
			<TokenField bearerToken={bearerToken} onToken={setBearerToken} />
			<Button className="self-end" disabled={create.isPending} type="submit">
				{create.isPending ? "Verifying…" : "Add server"}
			</Button>
		</form>
	);
}

export function AddMcpServerDialog() {
	const [open, setOpen] = useState(false);
	return (
		<Dialog onOpenChange={setOpen} open={open}>
			<DialogTrigger render={<Button size="sm" />}>
				<PlusIcon />
				Add server
			</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Add MCP server</DialogTitle>
				</DialogHeader>
				<ServerForm onCreated={() => setOpen(false)} />
			</DialogContent>
		</Dialog>
	);
}
