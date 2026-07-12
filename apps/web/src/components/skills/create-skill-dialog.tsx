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
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { MOBILE_FAB_CLASS } from "@/components/list/mobile-fab-class";
import { orpc } from "@/utils/orpc";
import {
	EMPTY_SKILL_FORM,
	isSkillFormValid,
	type SkillFormState,
	toSkillInput,
} from "./skill-form";
import { SkillFormFields } from "./skill-form-fields";

function useCreateSkill(onCreated: () => void) {
	const queryClient = useQueryClient();
	return useMutation(
		orpc.skills.create.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: orpc.skills.list.key() });
				toast.success("Skill created");
				onCreated();
			},
			onError: (error) => toast.error(error.message),
		})
	);
}

function useCreateSkillDialog() {
	const [open, setOpen] = useState(false);
	const [form, setForm] = useState<SkillFormState>(EMPTY_SKILL_FORM);
	const set = (patch: Partial<SkillFormState>) =>
		setForm((current) => ({ ...current, ...patch }));

	const create = useCreateSkill(() => setOpen(false));

	const onOpenChange = (next: boolean) => {
		setOpen(next);
		if (!next) {
			setForm(EMPTY_SKILL_FORM);
		}
	};

	const submit = () => {
		if (!isSkillFormValid(form)) {
			return;
		}
		create.mutate(toSkillInput(form));
	};

	return { form, isPending: create.isPending, onOpenChange, open, set, submit };
}

// Two triggers so the FAB (<md) and the toolbar button (desktop) open the
// same dialog — Base UI's Dialog.Root binds triggers via context, not DOM
// position, so both can live here as siblings.
function CreateSkillTriggers() {
	return (
		<>
			<DialogTrigger render={<Button size="sm" />}>
				<PlusIcon />
				New skill
			</DialogTrigger>
			<DialogTrigger
				render={
					<Button
						aria-label="New skill"
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
 * "New skill": name, description, instructions, and optional allowed tools /
 * MCP servers. Mirrors CreateMemoryDialog's self-triggering shape.
 */
export function CreateSkillDialog() {
	const { form, isPending, onOpenChange, open, set, submit } =
		useCreateSkillDialog();
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<CreateSkillTriggers />
			<DialogContent className="sm:max-w-lg">
				<DialogHeader className="gap-1.5">
					<DialogTitle>New skill</DialogTitle>
					<DialogDescription>
						A reusable playbook you can assign to any of your agents.
					</DialogDescription>
				</DialogHeader>
				<form
					className="flex flex-col gap-5"
					onSubmit={(event) => {
						event.preventDefault();
						submit();
					}}
				>
					<SkillFormFields form={form} onChange={set} />
					<DialogFooter className="gap-2">
						<Button
							onClick={() => onOpenChange(false)}
							type="button"
							variant="outline"
						>
							Cancel
						</Button>
						<Button
							disabled={isPending || !isSkillFormValid(form)}
							type="submit"
						>
							{isPending ? "Creating…" : "Create"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
