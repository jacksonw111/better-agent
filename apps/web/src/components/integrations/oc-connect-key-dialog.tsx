import { Button } from "@better-agent/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@better-agent/ui/components/dialog";
import { Input } from "@better-agent/ui/components/input";
import { Label } from "@better-agent/ui/components/label";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import type { OpenConnectorProviderRow } from "@/utils/api-types";
import { celebrateSuccess } from "@/utils/celebrate";
import { orpc } from "@/utils/orpc";

function useConnectWithKey(onDone: () => void) {
	const queryClient = useQueryClient();
	return useMutation(
		orpc.openConnector.connectWithKey.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.openConnector.connections.key(),
				});
				celebrateSuccess("Connected");
				onDone();
			},
			onError: (error) => toast.error(error.message),
		})
	);
}

function KeyForm({
	provider,
	pending,
	onSubmit,
}: {
	provider: OpenConnectorProviderRow;
	pending: boolean;
	onSubmit: (apiKey: string) => void;
}) {
	const [apiKey, setApiKey] = useState("");
	return (
		<form
			className="flex flex-col gap-3"
			onSubmit={(event) => {
				event.preventDefault();
				onSubmit(apiKey);
			}}
		>
			<div className="flex flex-col gap-1">
				<Label htmlFor="oc-provider-key">API key</Label>
				<Input
					autoComplete="off"
					id="oc-provider-key"
					onChange={(event) => setApiKey(event.target.value)}
					placeholder={`Your ${provider.displayName} API key`}
					required
					type="password"
					value={apiKey}
				/>
			</div>
			<Button className="self-end" disabled={pending} type="submit">
				{pending ? "Connecting…" : "Connect"}
			</Button>
		</form>
	);
}

/** Asks for the target provider's API key and connects it on this account. */
export function OcConnectKeyDialog({
	accountId,
	provider,
	onClose,
}: {
	accountId: string;
	provider: OpenConnectorProviderRow | null;
	onClose: () => void;
}) {
	const connect = useConnectWithKey(onClose);
	return (
		<Dialog
			onOpenChange={(open) => !open && onClose()}
			open={provider !== null}
		>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Connect {provider?.displayName}</DialogTitle>
				</DialogHeader>
				{provider ? (
					<KeyForm
						onSubmit={(apiKey) =>
							connect.mutate({
								accountId,
								service: provider.service,
								apiKey,
							})
						}
						pending={connect.isPending}
						provider={provider}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}
