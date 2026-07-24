import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@better-agent/ui/components/dialog";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { ProjectTemplate } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";
import { DialogFormFooter } from "./dialog-form-footer";
import { TemplateFields } from "./template-fields";
import {
	EMPTY_TEMPLATE_FORM,
	isTemplateFormValid,
	type TemplateFormState,
	templateToForm,
	toTemplateInput,
} from "./template-form";
import { useInvalidateProfile } from "./use-profile";

function useTemplateMutation(
	template: ProjectTemplate | null,
	onDone: () => void
) {
	const invalidate = useInvalidateProfile();
	const options = {
		onError: (error: Error) => toast.error(error.message),
		onSuccess: () => {
			invalidate();
			toast.success(template ? "Template updated" : "Template created");
			onDone();
		},
	};
	const create = useMutation(
		orpc.profiles.templates.create.mutationOptions(options)
	);
	const update = useMutation(
		orpc.profiles.templates.update.mutationOptions(options)
	);
	const submit = (form: TemplateFormState) => {
		const input = toTemplateInput(form);
		if (template) {
			update.mutate({ templateId: template.id, ...input });
		} else {
			create.mutate(input);
		}
	};
	return { pending: create.isPending || update.isPending, submit };
}

function TemplateDialogForm({
	form,
	setForm,
	pending,
	onSubmit,
	onCancel,
}: {
	form: TemplateFormState;
	setForm: (updater: (current: TemplateFormState) => TemplateFormState) => void;
	pending: boolean;
	onSubmit: () => void;
	onCancel: () => void;
}) {
	const set = (patch: Partial<TemplateFormState>) =>
		setForm((current) => ({ ...current, ...patch }));
	return (
		<form
			className="flex flex-col gap-5"
			onSubmit={(event) => {
				event.preventDefault();
				if (isTemplateFormValid(form)) {
					onSubmit();
				}
			}}
		>
			<TemplateFields form={form} onChange={set} />
			<DialogFormFooter
				disabled={pending || !isTemplateFormValid(form)}
				onCancel={onCancel}
				pending={pending}
			/>
		</form>
	);
}

/** Add / edit a project template: identity, scaffold, project CLAUDE.md, and
 * project MCP servers. A `null` template is "add"; a row pre-fills for update.
 * Re-seeds its draft whenever it opens. */
export function TemplateDialog({
	template,
	open,
	onOpenChange,
}: {
	template: ProjectTemplate | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const [form, setForm] = useState<TemplateFormState>(EMPTY_TEMPLATE_FORM);
	useEffect(() => {
		if (open) {
			setForm(template ? templateToForm(template) : EMPTY_TEMPLATE_FORM);
		}
	}, [open, template]);

	const { pending, submit } = useTemplateMutation(template, () =>
		onOpenChange(false)
	);

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader className="gap-1.5">
					<DialogTitle>
						{template ? "Edit template" : "New template"}
					</DialogTitle>
					<DialogDescription>
						A reusable project scaffold: files and folders to lay down, an
						optional project CLAUDE.md, and MCP servers to seed.
					</DialogDescription>
				</DialogHeader>
				<TemplateDialogForm
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
