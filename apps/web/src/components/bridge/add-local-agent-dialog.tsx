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
import { cn } from "@better-agent/ui/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { MOBILE_FAB_CLASS } from "@/components/list/mobile-fab-class";
import { assignMemoriesSafely } from "@/components/memory/assign-memories";
import { MemoryPicker } from "@/components/memory/memory-picker";
import type { BridgeTokenRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";
import {
	AGENT_KIND_LABEL,
	AGENT_KIND_OPTIONS,
	AgentKindIcon,
} from "./local-agent-kind-icon";

type AgentKind = BridgeTokenRow["agentKind"];

function useCreateBridgeToken(onCreated: (tokenId: string) => Promise<void>) {
	const queryClient = useQueryClient();
	return useMutation(
		orpc.bridge.createToken.mutationOptions({
			onSuccess: async (result) => {
				queryClient.invalidateQueries({
					queryKey: orpc.bridge.listTokens.key(),
				});
				await onCreated(result.id);
			},
			onError: (error) => toast.error(error.message),
		})
	);
}

function AgentKindPicker({
	value,
	onChange,
}: {
	value: AgentKind | null;
	onChange: (kind: AgentKind) => void;
}) {
	return (
		<div className="flex flex-col gap-2">
			<Label>Agent</Label>
			<div className="grid grid-cols-2 gap-2">
				{AGENT_KIND_OPTIONS.map((kind) => {
					const selected = kind === value;
					return (
						<button
							aria-pressed={selected}
							className={cn(
								"flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors",
								selected
									? "border-primary bg-primary/10 text-foreground"
									: "text-muted-foreground hover:bg-muted hover:text-foreground"
							)}
							key={kind}
							onClick={() => onChange(kind)}
							type="button"
						>
							<AgentKindIcon className="size-4 shrink-0" kind={kind} />
							{AGENT_KIND_LABEL[kind]}
						</button>
					);
				})}
			</div>
		</div>
	);
}

function LocalAgentDetailsFields({
	name,
	onName,
	memoryIds,
	onMemoryIds,
}: {
	name: string;
	onName: (value: string) => void;
	memoryIds: string[];
	onMemoryIds: (ids: string[]) => void;
}) {
	return (
		<>
			<div className="flex flex-col gap-2">
				<Label htmlFor="local-agent-name">Name</Label>
				<Input
					id="local-agent-name"
					onChange={(event) => onName(event.target.value)}
					placeholder="e.g. laptop"
					value={name}
				/>
			</div>
			<div className="flex flex-col gap-2">
				<Label>Memories (optional)</Label>
				<MemoryPicker onChange={onMemoryIds} selected={memoryIds} />
			</div>
		</>
	);
}

function AddLocalAgentForm({
	name,
	onName,
	kind,
	onKind,
	memoryIds,
	onMemoryIds,
	onSubmit,
	onCancel,
	pending,
}: {
	name: string;
	onName: (value: string) => void;
	kind: AgentKind | null;
	onKind: (value: AgentKind) => void;
	memoryIds: string[];
	onMemoryIds: (ids: string[]) => void;
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
			<AgentKindPicker onChange={onKind} value={kind} />
			<LocalAgentDetailsFields
				memoryIds={memoryIds}
				name={name}
				onMemoryIds={onMemoryIds}
				onName={onName}
			/>
			<DialogFooter className="gap-2">
				<Button onClick={onCancel} type="button" variant="outline">
					Cancel
				</Button>
				<Button disabled={pending || kind === null} type="submit">
					{pending ? "Creating…" : "Create"}
				</Button>
			</DialogFooter>
		</form>
	);
}

function useAddLocalAgentDialog(
	controlledOpen?: boolean,
	controlledOnOpenChange?: (open: boolean) => void
) {
	const navigate = useNavigate();
	const [internalOpen, setInternalOpen] = useState(false);
	const open = controlledOpen ?? internalOpen;
	const setOpen = controlledOnOpenChange ?? setInternalOpen;
	const [name, setName] = useState("");
	const [kind, setKind] = useState<AgentKind | null>(null);
	const [memoryIds, setMemoryIds] = useState<string[]>([]);

	const create = useCreateBridgeToken(async (tokenId) => {
		await assignMemoriesSafely({ tokenId }, memoryIds);
		setOpen(false);
		navigate({ params: { tokenId }, to: "/local/$tokenId" });
	});

	const onOpenChange = (next: boolean) => {
		setOpen(next);
		if (!next) {
			setName("");
			setKind(null);
			setMemoryIds([]);
		}
	};

	const submit = () => {
		if (kind) {
			create.mutate({ agentKind: kind, name: name.trim() || undefined });
		}
	};

	return {
		isPending: create.isPending,
		kind,
		memoryIds,
		name,
		onOpenChange,
		setKind,
		setMemoryIds,
		setName,
		submit,
		open,
	};
}

// Two triggers so the FAB (<md) and the toolbar button (desktop) open the
// same dialog — Base UI's Dialog.Root binds triggers via context, not DOM
// position, so both can live here as siblings.
function AddLocalAgentTriggers() {
	return (
		<>
			<DialogTrigger render={<Button size="sm" />}>
				<PlusIcon />
				Add local agent
			</DialogTrigger>
			<DialogTrigger
				render={
					<Button
						aria-label="Add local agent"
						className={MOBILE_FAB_CLASS}
						size="icon"
					/>
				}
			>
				<PlusIcon className="size-5" />
			</DialogTrigger>
		</>
	);
}

/**
 * "Add a local agent": pick which agent this token is for (bound to it for
 * life) and optionally name it, then create. The raw token lives on the new
 * agent's own page — we navigate there on success rather than revealing it
 * once here.
 *
 * Standalone (no props) it owns its own open state and renders the toolbar +
 * FAB triggers. Pass `open`/`onOpenChange` to drive it from a parent (e.g. the
 * merged agents list's Add menu) and `hideTrigger` to suppress the built-in
 * triggers.
 */
export function AddLocalAgentDialog({
	open: controlledOpen,
	onOpenChange: controlledOnOpenChange,
	hideTrigger = false,
}: {
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	hideTrigger?: boolean;
} = {}) {
	const {
		isPending,
		kind,
		memoryIds,
		name,
		onOpenChange,
		setKind,
		setMemoryIds,
		setName,
		submit,
		open,
	} = useAddLocalAgentDialog(controlledOpen, controlledOnOpenChange);
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			{hideTrigger ? null : <AddLocalAgentTriggers />}
			<DialogContent className="sm:max-w-lg">
				<DialogHeader className="gap-1.5">
					<DialogTitle>Add local agent</DialogTitle>
					<DialogDescription>
						Choose which agent this connection runs, then find its token and
						ready-to-run command on the agent's page.
					</DialogDescription>
				</DialogHeader>
				<AddLocalAgentForm
					kind={kind}
					memoryIds={memoryIds}
					name={name}
					onCancel={() => onOpenChange(false)}
					onKind={setKind}
					onMemoryIds={setMemoryIds}
					onName={setName}
					onSubmit={submit}
					pending={isPending}
				/>
			</DialogContent>
		</Dialog>
	);
}
