import { Button } from "@better-agent/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@better-agent/ui/components/dialog";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@better-agent/ui/components/tooltip";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PencilIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { ProjectListItem } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";
import {
	EMPTY_PROJECT_DRAFT,
	isValidGitUrl,
	ProjectDialogFooter,
	type ProjectDraft,
	ProjectDraftFields,
} from "./project-form-fields";

// The project Edit dialog (same form as New, project-form-fields.tsx): name
// and Git URL prefilled, token blank-means-keep. Only CHANGED fields travel —
// the unchanged Git URL is omitted so a rename alone never re-clones; a repo
// or token change resets the clone server-side and the detail page's poll
// then follows created→cloning→ready/error like any fresh clone.

interface UpdatePayload {
	name?: string;
	projectId: string;
	repoUrl?: string;
	token?: string;
}

/** The changed-fields-only payload, or null when nothing changed. */
export function toUpdatePayload(
	project: ProjectListItem,
	draft: ProjectDraft
): UpdatePayload | null {
	const payload: UpdatePayload = { projectId: project.id };
	const name = draft.name.trim();
	const repoUrl = draft.repoUrl.trim();
	if (name !== project.name) {
		payload.name = name;
	}
	if (repoUrl !== project.repoCloneUrl) {
		payload.repoUrl = repoUrl;
	}
	if (draft.token !== "") {
		payload.token = draft.token;
	}
	const changed = Object.keys(payload).length > 1;
	return changed ? payload : null;
}

function draftFor(project: ProjectListItem): ProjectDraft {
	return { name: project.name, repoUrl: project.repoCloneUrl, token: "" };
}

/** projects.update; success refreshes the detail + list (whose poll follows a
 * triggered re-clone) and hands control back to the dialog. */
function useUpdateProject(onSaved: () => void) {
	const queryClient = useQueryClient();
	const update = useMutation(
		orpc.projects.update.mutationOptions({
			onError: (error: Error) => toast.error(error.message),
		})
	);
	const submit = (payload: UpdatePayload) =>
		update.mutate(payload, {
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: orpc.projects.get.key() });
				queryClient.invalidateQueries({ queryKey: orpc.projects.list.key() });
				toast.success("Project updated");
				onSaved();
			},
		});
	return { pending: update.isPending, submit };
}

/** The header's Edit icon action — the same tooltip'd icon-button treatment
 * as the Delete action beside it. */
function EditTrigger() {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<DialogTrigger
						render={<Button aria-label="Edit" size="icon-xs" variant="ghost" />}
					/>
				}
			>
				<PencilIcon className="size-4" />
			</TooltipTrigger>
			<TooltipContent>Edit</TooltipContent>
		</Tooltip>
	);
}

/** Self-contained Edit dialog — an icon action for the detail header, same
 * treatment as the Delete action beside it. */
export function EditProjectDialog({ project }: { project: ProjectListItem }) {
	const [open, setOpen] = useState(false);
	const [draft, setDraft] = useState<ProjectDraft>(EMPTY_PROJECT_DRAFT);
	const onOpenChange = (next: boolean) => {
		setOpen(next);
		if (next) {
			setDraft(draftFor(project));
		}
	};
	const update = useUpdateProject(() => setOpen(false));
	const payload = toUpdatePayload(project, draft);
	const valid =
		payload !== null &&
		draft.name.trim().length > 0 &&
		isValidGitUrl(draft.repoUrl);
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<EditTrigger />
			<DialogContent className="sm:max-w-md">
				<DialogHeader className="gap-1.5">
					<DialogTitle>Edit project</DialogTitle>
					<DialogDescription>
						Rename the project or point it at a different repository — changing
						the Git URL or token clones the repository again on this computer.
					</DialogDescription>
				</DialogHeader>
				<ProjectDraftFields
					draft={draft}
					onChange={setDraft}
					tokenHint={
						project.tokenLast4
							? `Leave blank to keep the current token (ends in ${project.tokenLast4}).`
							: "Leave blank to keep the project token-free."
					}
					tokenLabel="Access token"
				/>
				<ProjectDialogFooter
					disabled={!valid || update.pending}
					idleLabel="Save changes"
					onCancel={() => onOpenChange(false)}
					onSubmit={() => payload && update.submit(payload)}
					pending={update.pending}
					pendingLabel="Saving…"
				/>
			</DialogContent>
		</Dialog>
	);
}
