import { Button } from "@better-agent/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@better-agent/ui/components/dialog";
import { Input } from "@better-agent/ui/components/input";
import { Label } from "@better-agent/ui/components/label";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { orpc } from "@/utils/orpc";

function useCreateMemory(onCreated: (memoryId: string) => void) {
	const queryClient = useQueryClient();
	return useMutation(
		orpc.memory.createMemory.mutationOptions({
			onSuccess: (result) => {
				queryClient.invalidateQueries({
					queryKey: orpc.memory.listMemories.key(),
				});
				onCreated(result.id);
			},
			onError: (error) => toast.error(error.message),
		})
	);
}

function MemoryFormFields({
	name,
	onName,
	description,
	onDescription,
}: {
	name: string;
	onName: (value: string) => void;
	description: string;
	onDescription: (value: string) => void;
}) {
	return (
		<>
			<div className="flex flex-col gap-2">
				<Label htmlFor="memory-name">Name</Label>
				<Input
					id="memory-name"
					onChange={(event) => onName(event.target.value)}
					placeholder="e.g. Project conventions"
					value={name}
				/>
			</div>
			<div className="flex flex-col gap-2">
				<Label htmlFor="memory-description">Description (optional)</Label>
				<Input
					id="memory-description"
					onChange={(event) => onDescription(event.target.value)}
					placeholder="What this knowledge base is for"
					value={description}
				/>
			</div>
		</>
	);
}

function CreateMemoryForm({
	name,
	onName,
	description,
	onDescription,
	onSubmit,
	onCancel,
	pending,
}: {
	name: string;
	onName: (value: string) => void;
	description: string;
	onDescription: (value: string) => void;
	onSubmit: () => void;
	onCancel: () => void;
	pending: boolean;
}) {
	return (
		<form
			className="flex flex-col gap-5"
			onSubmit={(event) => {
				event.preventDefault();
				onSubmit();
			}}
		>
			<MemoryFormFields
				description={description}
				name={name}
				onDescription={onDescription}
				onName={onName}
			/>
			<DialogFooter className="gap-2">
				<Button onClick={onCancel} type="button" variant="outline">
					Cancel
				</Button>
				<Button disabled={pending || name.trim() === ""} type="submit">
					{pending ? "Creating…" : "Create"}
				</Button>
			</DialogFooter>
		</form>
	);
}

function useCreateMemoryDialog() {
	const navigate = useNavigate();
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");

	const create = useCreateMemory((memoryId) => {
		setOpen(false);
		navigate({ params: { memoryId }, to: "/memories/$memoryId" });
	});

	const onOpenChange = (next: boolean) => {
		setOpen(next);
		if (!next) {
			setName("");
			setDescription("");
		}
	};

	const submit = () => {
		const trimmed = name.trim();
		if (trimmed === "") {
			return;
		}
		create.mutate({
			name: trimmed,
			description: description.trim() || undefined,
		});
	};

	return {
		description,
		isPending: create.isPending,
		name,
		onOpenChange,
		setDescription,
		setName,
		submit,
		open,
	};
}

/**
 * "New memory": name a knowledge base (description optional) and create it.
 * Navigates to the new memory's detail page on success so items can be added
 * right away.
 */
export function CreateMemoryDialog() {
	const {
		description,
		isPending,
		name,
		onOpenChange,
		setDescription,
		setName,
		submit,
		open,
	} = useCreateMemoryDialog();
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogTrigger render={<Button size="sm" />}>
				<PlusIcon />
				New memory
			</DialogTrigger>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader className="gap-1.5">
					<DialogTitle>New memory</DialogTitle>
					<DialogDescription>
						A named knowledge base you can fill with facts and assign to any of
						your agents.
					</DialogDescription>
				</DialogHeader>
				<CreateMemoryForm
					description={description}
					name={name}
					onCancel={() => onOpenChange(false)}
					onDescription={setDescription}
					onName={setName}
					onSubmit={submit}
					pending={isPending}
				/>
			</DialogContent>
		</Dialog>
	);
}
