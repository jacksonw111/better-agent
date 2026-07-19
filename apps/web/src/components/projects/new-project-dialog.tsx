import { Button } from "@better-agent/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@better-agent/ui/components/dialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { orpc } from "@/utils/orpc";
import {
	EMPTY_PROJECT_DRAFT,
	isValidGitUrl,
	ProjectDialogFooter,
	type ProjectDraft,
	ProjectDraftFields,
} from "./project-form-fields";

// Q3: "New project" — registers a long-lived checkout of one git repository
// on this computer. Any git remote works: an https URL on any host, or the
// ssh form `git@host:path.git` (which clones with this computer's ssh keys).
// Creation queues the clone on the machine; the Projects list's poll
// (project-list.tsx) then follows created/cloning to ready/error. The token
// is OPTIONAL and omitted (not sent empty) when left blank. The form fields
// are shared with the Edit dialog (project-form-fields.tsx).

/** projects.create with the blank token OMITTED; success refreshes the list
 * (whose poll follows the clone) and hands control back to the dialog. */
function useCreateProject(computerId: string, onCreated: () => void) {
	const queryClient = useQueryClient();
	const create = useMutation(
		orpc.projects.create.mutationOptions({
			onError: (error: Error) => toast.error(error.message),
		})
	);
	const submit = (draft: ProjectDraft) =>
		create.mutate(
			{
				computerId,
				name: draft.name.trim(),
				repoUrl: draft.repoUrl.trim(),
				token: draft.token === "" ? undefined : draft.token,
			},
			{
				onSuccess: () => {
					queryClient.invalidateQueries({
						queryKey: orpc.projects.list.key(),
					});
					onCreated();
				},
			}
		);
	return { pending: create.isPending, submit };
}

/** Self-contained "New project" dialog — owns its trigger and open state so
 * the Projects section drops it into its header without wiring. */
export function NewProjectDialog({ computerId }: { computerId: string }) {
	const [open, setOpen] = useState(false);
	const [draft, setDraft] = useState<ProjectDraft>(EMPTY_PROJECT_DRAFT);
	const onOpenChange = (next: boolean) => {
		setOpen(next);
		if (!next) {
			setDraft(EMPTY_PROJECT_DRAFT);
		}
	};
	const create = useCreateProject(computerId, () => onOpenChange(false));
	const valid = draft.name.trim().length > 0 && isValidGitUrl(draft.repoUrl);
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogTrigger render={<Button size="sm" />}>
				<PlusIcon />
				New project
			</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<DialogHeader className="gap-1.5">
					<DialogTitle>New project</DialogTitle>
					<DialogDescription>
						Clone a git repository onto this computer — every session started
						from the project works in the same checkout.
					</DialogDescription>
				</DialogHeader>
				<ProjectDraftFields
					draft={draft}
					onChange={setDraft}
					tokenHint="Only used with https URLs — ssh addresses clone with this computer's ssh keys."
					tokenLabel="Access token (optional)"
				/>
				<ProjectDialogFooter
					disabled={!valid || create.pending}
					idleLabel="Create project"
					onCancel={() => onOpenChange(false)}
					onSubmit={() => create.submit(draft)}
					pending={create.pending}
					pendingLabel="Creating…"
				/>
			</DialogContent>
		</Dialog>
	);
}
