import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@better-agent/ui/components/dialog";
import { Input } from "@better-agent/ui/components/input";
import { Label } from "@better-agent/ui/components/label";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { ProfileStandard } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";
import { DialogFormFooter } from "./dialog-form-footer";
import { MarkdownField } from "./markdown-field";
import {
	EMPTY_STANDARD_FORM,
	isStandardFormValid,
	type StandardFormState,
	standardToForm,
	toStandardInput,
} from "./standard-form";
import { useInvalidateProfile } from "./use-profile";

function useStandardMutation(
	standard: ProfileStandard | null,
	onDone: () => void
) {
	const invalidate = useInvalidateProfile();
	const options = {
		onError: (error: Error) => toast.error(error.message),
		onSuccess: () => {
			invalidate();
			toast.success(standard ? "Standard updated" : "Standard added");
			onDone();
		},
	};
	const create = useMutation(
		orpc.profiles.standards.create.mutationOptions(options)
	);
	const update = useMutation(
		orpc.profiles.standards.update.mutationOptions(options)
	);
	const submit = (form: StandardFormState) => {
		const input = toStandardInput(form);
		if (standard) {
			update.mutate({ standardId: standard.id, ...input });
		} else {
			create.mutate(input);
		}
	};
	return { pending: create.isPending || update.isPending, submit };
}

function StandardDialogForm({
	form,
	setForm,
	pending,
	onSubmit,
	onCancel,
}: {
	form: StandardFormState;
	setForm: (updater: (current: StandardFormState) => StandardFormState) => void;
	pending: boolean;
	onSubmit: () => void;
	onCancel: () => void;
}) {
	return (
		<form
			className="flex flex-col gap-5"
			onSubmit={(event) => {
				event.preventDefault();
				if (isStandardFormValid(form)) {
					onSubmit();
				}
			}}
		>
			<div className="flex flex-col gap-2">
				<Label htmlFor="standard-title">Title</Label>
				<Input
					id="standard-title"
					onChange={(event) =>
						setForm((f) => ({ ...f, title: event.target.value }))
					}
					placeholder="e.g. Always run the formatter before committing"
					value={form.title}
				/>
			</div>
			<MarkdownField
				id="standard-body"
				label="Rule (markdown)"
				onChange={(body) => setForm((f) => ({ ...f, body }))}
				placeholder="Describe the rule the agent must follow…"
				value={form.body}
			/>
			<DialogFormFooter
				disabled={pending || !isStandardFormValid(form)}
				onCancel={onCancel}
				pending={pending}
			/>
		</form>
	);
}

/** Add / edit a standard: title + markdown body. A `null` standard is the
 * "add" mode; passing a row pre-fills and switches to update. Re-seeds its
 * draft whenever it opens for a (possibly different) row. */
export function StandardDialog({
	standard,
	open,
	onOpenChange,
}: {
	standard: ProfileStandard | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const [form, setForm] = useState<StandardFormState>(EMPTY_STANDARD_FORM);
	useEffect(() => {
		if (open) {
			setForm(standard ? standardToForm(standard) : EMPTY_STANDARD_FORM);
		}
	}, [open, standard]);

	const { pending, submit } = useStandardMutation(standard, () =>
		onOpenChange(false)
	);

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader className="gap-1.5">
					<DialogTitle>
						{standard ? "Edit standard" : "New standard"}
					</DialogTitle>
					<DialogDescription>
						A rule that lands in every computer's ~/.claude/CLAUDE.md and
						applies across all projects.
					</DialogDescription>
				</DialogHeader>
				<StandardDialogForm
					form={form}
					onCancel={() => onOpenChange(false)}
					onSubmit={() => submit(form)}
					pending={pending}
					setForm={setForm}
				/>
			</DialogContent>
		</Dialog>
	);
}
