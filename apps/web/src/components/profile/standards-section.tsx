import { Button } from "@better-agent/ui/components/button";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/layout/empty-state";
import type { ProfileStandard } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";
import { ProfileSectionSkeleton } from "./profile-skeletons";
import { SectionHeader } from "./section-header";
import { StandardDialog } from "./standard-dialog";
import { StandardsList } from "./standards-list";
import { useInvalidateProfile, useProfile } from "./use-profile";

function useStandardActions() {
	const invalidate = useInvalidateProfile();
	const options = {
		onError: (error: Error) => toast.error(error.message),
		onSuccess: () => invalidate(),
	};
	const update = useMutation(
		orpc.profiles.standards.update.mutationOptions(options)
	);
	const remove = useMutation(
		orpc.profiles.standards.delete.mutationOptions(options)
	);
	const reorder = useMutation(
		orpc.profiles.standards.reorder.mutationOptions(options)
	);
	return { remove, reorder, update };
}

function moveInOrder(ids: string[], id: string, direction: -1 | 1): string[] {
	const from = ids.indexOf(id);
	const to = from + direction;
	if (from === -1 || to < 0 || to >= ids.length) {
		return ids;
	}
	const next = [...ids];
	[next[from], next[to]] = [next[to], next[from]];
	return next;
}

const INTRO =
	"Standards are the rules your agents always follow. They land in every computer's ~/.claude/CLAUDE.md and apply across all projects — reorder them to set precedence.";

function StandardsBody({
	standards,
	onCreate,
	actions,
	onEdit,
}: {
	standards: ProfileStandard[];
	onCreate: () => void;
	actions: ReturnType<typeof useStandardActions>;
	onEdit: (standard: ProfileStandard) => void;
}) {
	if (standards.length === 0) {
		return (
			<EmptyState
				action={
					<Button onClick={onCreate} size="sm" variant="outline">
						Add your first standard
					</Button>
				}
				body="Add a rule and it will sync to every computer's global CLAUDE.md."
				title="No standards yet"
			/>
		);
	}
	const move = (id: string, direction: -1 | 1) =>
		actions.reorder.mutate({
			orderedIds: moveInOrder(
				standards.map((s) => s.id),
				id,
				direction
			),
		});
	return (
		<StandardsList
			callbacks={{
				onDelete: (id) => actions.remove.mutate({ standardId: id }),
				onEdit,
				onMove: move,
				onToggle: (standard, enabled) =>
					actions.update.mutate({ standardId: standard.id, enabled }),
			}}
			standards={standards}
		/>
	);
}

/** The Standards tab: list + inline enable/reorder + add/edit/delete, all
 * driven by `profiles.standards.*` and the shared profile query. */
export function StandardsSection() {
	const profile = useProfile();
	const actions = useStandardActions();
	const [editing, setEditing] = useState<ProfileStandard | null>(null);
	const [creating, setCreating] = useState(false);

	if (profile.isPending) {
		return <ProfileSectionSkeleton />;
	}

	return (
		<div className="flex flex-col gap-4">
			<SectionHeader
				createLabel="New standard"
				intro={INTRO}
				onCreate={() => setCreating(true)}
			/>
			<StandardsBody
				actions={actions}
				onCreate={() => setCreating(true)}
				onEdit={setEditing}
				standards={profile.data?.standards ?? []}
			/>
			<StandardDialog
				onOpenChange={setCreating}
				open={creating}
				standard={null}
			/>
			<StandardDialog
				onOpenChange={(open) => {
					if (!open) {
						setEditing(null);
					}
				}}
				open={editing !== null}
				standard={editing}
			/>
		</div>
	);
}
