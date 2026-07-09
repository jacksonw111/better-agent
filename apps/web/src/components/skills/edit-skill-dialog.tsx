import { Button } from "@better-agent/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@better-agent/ui/components/dialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { orpc } from "@/utils/orpc";
import {
	isSkillFormValid,
	type SkillFormState,
	skillRowToForm,
	toSkillInput,
} from "./skill-form";
import { SkillFormFields } from "./skill-form-fields";
import type { SkillRow } from "./skill-types";

function useUpdateSkill(onSaved: () => void) {
	const queryClient = useQueryClient();
	return useMutation(
		orpc.skills.update.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: orpc.skills.list.key() });
				toast.success("Skill updated");
				onSaved();
			},
			onError: (error) => toast.error(error.message),
		})
	);
}

/** Owns the draft state, re-seeded from `skill` whenever the dialog opens for
 * a (possibly different) skill — same re-seed-on-open pattern as
 * LocalAgentSettingsDialog's useSettingsDraft. */
function useEditSkillDraft(
	skill: SkillRow,
	open: boolean,
	onSaved: () => void
) {
	const [form, setForm] = useState<SkillFormState>(() => skillRowToForm(skill));
	useEffect(() => {
		if (open) {
			setForm(skillRowToForm(skill));
		}
	}, [open, skill]);

	const update = useUpdateSkill(onSaved);
	const set = (patch: Partial<SkillFormState>) =>
		setForm((current) => ({ ...current, ...patch }));
	const submit = () => {
		if (!isSkillFormValid(form)) {
			return;
		}
		update.mutate({ skillId: skill.id, ...toSkillInput(form) });
	};

	return { form, pending: update.isPending, set, submit };
}

/** "Edit skill": a controlled dialog opened from the skill table's row (the
 * name button), pre-filled with the skill's current fields. */
export function EditSkillDialog({
	skill,
	open,
	onOpenChange,
}: {
	skill: SkillRow;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const { form, pending, set, submit } = useEditSkillDraft(skill, open, () =>
		onOpenChange(false)
	);
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Edit skill</DialogTitle>
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
						<Button disabled={pending || !isSkillFormValid(form)} type="submit">
							{pending ? "Saving…" : "Save"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
