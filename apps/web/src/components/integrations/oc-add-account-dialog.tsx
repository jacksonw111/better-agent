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

function useCreateAccount(onDone: () => void) {
	const queryClient = useQueryClient();
	return useMutation(
		orpc.openConnector.createAccount.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.openConnector.listAccounts.key(),
				});
				celebrateSuccess("Account added");
				onDone();
			},
			onError: (error) => toast.error(error.message),
		})
	);
}

interface AccountFields {
	adminToken: string;
	baseUrl: string;
	name: string;
	runtimeToken: string;
}

const EMPTY_FIELDS: AccountFields = {
	name: "",
	baseUrl: "",
	adminToken: "",
	runtimeToken: "",
};

interface FieldDef {
	key: keyof AccountFields;
	label: string;
	placeholder: string;
	secret?: boolean;
	type?: "url" | "password";
}

const FIELD_DEFS: FieldDef[] = [
	{ key: "name", label: "Name", placeholder: "e.g. My connectors" },
	{
		key: "baseUrl",
		label: "Base URL",
		placeholder: "https://open-connector.<acct>.workers.dev",
		type: "url",
	},
	{
		key: "adminToken",
		label: "Admin token",
		placeholder: "Admin token",
		type: "password",
		secret: true,
	},
	{
		key: "runtimeToken",
		label: "Runtime token",
		placeholder: "Runtime token",
		type: "password",
		secret: true,
	},
];

function AccountField({
	def,
	value,
	onChange,
}: {
	def: FieldDef;
	value: string;
	onChange: (value: string) => void;
}) {
	const id = `oc-${def.key}`;
	return (
		<div className="flex flex-col gap-1">
			<Label htmlFor={id}>{def.label}</Label>
			<Input
				autoComplete={def.secret ? "off" : undefined}
				id={id}
				onChange={(event) => onChange(event.target.value)}
				placeholder={def.placeholder}
				required
				type={def.type}
				value={value}
			/>
		</div>
	);
}

function AccountForm({ onCreated }: { onCreated: () => void }) {
	const [fields, setFields] = useState<AccountFields>(EMPTY_FIELDS);
	const create = useCreateAccount(() => {
		setFields(EMPTY_FIELDS);
		onCreated();
	});

	return (
		<form
			className="flex flex-col gap-3"
			onSubmit={(event) => {
				event.preventDefault();
				create.mutate(fields);
			}}
		>
			{FIELD_DEFS.map((def) => (
				<AccountField
					def={def}
					key={def.key}
					onChange={(value) =>
						setFields((prev) => ({ ...prev, [def.key]: value }))
					}
					value={fields[def.key]}
				/>
			))}
			<Button className="self-end" disabled={create.isPending} type="submit">
				Add account
			</Button>
		</form>
	);
}

export function OcAddAccountDialog() {
	const [open, setOpen] = useState(false);
	return (
		<Dialog onOpenChange={setOpen} open={open}>
			<DialogTrigger render={<Button size="sm" />}>
				<PlusIcon />
				Add account
			</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Add OpenConnector account</DialogTitle>
				</DialogHeader>
				<AccountForm onCreated={() => setOpen(false)} />
			</DialogContent>
		</Dialog>
	);
}
