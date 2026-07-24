import { Button } from "@better-agent/ui/components/button";
import {
	Card,
	CardContent,
	CardFooter,
} from "@better-agent/ui/components/card";
import { useMutation } from "@tanstack/react-query";
import { PencilIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/layout/empty-state";
import { DeleteConfirm } from "@/components/list/delete-confirm";
import type { ProjectTemplate } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";
import { ProfileSectionSkeleton } from "./profile-skeletons";
import { SectionHeader } from "./section-header";
import { TemplateDialog } from "./template-dialog";
import { useInvalidateProfile, useProfile } from "./use-profile";

const INTRO =
	"Templates scaffold a new project in one step: files and folders, an optional project-level CLAUDE.md layered on your standards, and the MCP servers it needs.";

function useDeleteTemplate() {
	const invalidate = useInvalidateProfile();
	return useMutation(
		orpc.profiles.templates.delete.mutationOptions({
			onError: (error: Error) => toast.error(error.message),
			onSuccess: () => {
				invalidate();
				toast.success("Template deleted");
			},
		})
	);
}

function TemplateCard({
	template,
	onEdit,
	onDelete,
}: {
	template: ProjectTemplate;
	onEdit: (template: ProjectTemplate) => void;
	onDelete: (id: string) => void;
}) {
	const fileCount = template.scaffold.files.length;
	const dirCount = template.scaffold.dirs.length;
	return (
		<Card>
			<CardContent className="flex flex-col gap-1.5">
				<button
					className="text-left font-medium text-sm hover:underline"
					onClick={() => onEdit(template)}
					type="button"
				>
					{template.name}
				</button>
				<p className="text-muted-foreground text-xs">
					{template.description || "No description"}
				</p>
				<p className="text-muted-foreground text-xs">
					{fileCount} files · {dirCount} dirs · {template.mcpServerIds.length}{" "}
					MCP
				</p>
			</CardContent>
			<CardFooter className="justify-end gap-1">
				<Button
					aria-label={`Edit ${template.name}`}
					onClick={() => onEdit(template)}
					size="icon-xs"
					variant="ghost"
				>
					<PencilIcon className="size-4" />
				</Button>
				<DeleteConfirm
					label={`Delete "${template.name}"?`}
					onConfirm={() => onDelete(template.id)}
				/>
			</CardFooter>
		</Card>
	);
}

/** The Templates tab: card-per-template with add/edit/delete via
 * `profiles.templates.*` and the shared profile query. */
function TemplatesGrid({
	templates,
	onCreate,
	onEdit,
	onDelete,
}: {
	templates: ProjectTemplate[];
	onCreate: () => void;
	onEdit: (template: ProjectTemplate) => void;
	onDelete: (id: string) => void;
}) {
	if (templates.length === 0) {
		return (
			<EmptyState
				action={
					<Button onClick={onCreate} size="sm" variant="outline">
						Create your first template
					</Button>
				}
				body="Templates make starting a new project a one-click scaffold."
				title="No templates yet"
			/>
		);
	}
	return (
		<div className="grid gap-3 sm:grid-cols-2">
			{templates.map((template) => (
				<TemplateCard
					key={template.id}
					onDelete={onDelete}
					onEdit={onEdit}
					template={template}
				/>
			))}
		</div>
	);
}

export function TemplatesSection() {
	const profile = useProfile();
	const remove = useDeleteTemplate();
	const [editing, setEditing] = useState<ProjectTemplate | null>(null);
	const [creating, setCreating] = useState(false);

	if (profile.isPending) {
		return <ProfileSectionSkeleton />;
	}

	return (
		<div className="flex flex-col gap-4">
			<SectionHeader
				createLabel="New template"
				intro={INTRO}
				onCreate={() => setCreating(true)}
			/>
			<TemplatesGrid
				onCreate={() => setCreating(true)}
				onDelete={(id) => remove.mutate({ templateId: id })}
				onEdit={setEditing}
				templates={profile.data?.templates ?? []}
			/>
			<TemplateDialog
				onOpenChange={setCreating}
				open={creating}
				template={null}
			/>
			<TemplateDialog
				onOpenChange={(open) => {
					if (!open) {
						setEditing(null);
					}
				}}
				open={editing !== null}
				template={editing}
			/>
		</div>
	);
}
