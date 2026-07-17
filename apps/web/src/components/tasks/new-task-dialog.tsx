import { Button } from "@better-agent/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@better-agent/ui/components/dialog";
import { useState } from "react";
import { NewTaskWizard, useWizardDraft } from "./new-task-wizard";
import { draftHasContent } from "./wizard-state";

// The New Task wizard's modal shell. The three steps themselves live in
// new-task-wizard.tsx — this file owns only the Dialog chrome, the draft
// (hoisted here so closing can check for unsaved content), and the discard
// confirmation. Open state is controlled by the caller (/tasks), which also
// backs the ?new=1 deep link that replaced the old /tasks/new page.

// Wide enough for the three steps; edge-to-edge so only the step body
// scrolls (the wizard pins its indicator and footer). Under `sm` the modal
// degrades to full screen instead of a floating card.
const CONTENT_CLASS =
	"flex flex-col gap-4 overflow-hidden p-0 max-sm:top-0 max-sm:left-0 max-sm:h-svh max-sm:max-h-svh max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none sm:max-w-2xl";

/** "Discard this task?" — only ever shown for a draft with content; an
 * untouched wizard closes silently. */
function DiscardConfirmDialog({
	onDiscard,
	onKeepEditing,
	open,
}: {
	onDiscard: () => void;
	onKeepEditing: () => void;
	open: boolean;
}) {
	return (
		<Dialog
			onOpenChange={(next: boolean) => {
				if (!next) {
					onKeepEditing();
				}
			}}
			open={open}
		>
			<DialogContent className="sm:max-w-sm" showCloseButton={false}>
				<DialogHeader>
					<DialogTitle>Discard this task?</DialogTitle>
					<DialogDescription>
						Closing throws away the steps you already filled in.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button onClick={onKeepEditing} type="button" variant="outline">
						Keep editing
					</Button>
					<Button onClick={onDiscard} type="button" variant="destructive">
						Discard
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/**
 * New Task as a modal: Runtime → Request → GitHub inside a Dialog. Closing
 * (X, Esc, backdrop) with content in the draft asks before discarding; a
 * successful Start closes without asking and the wizard navigates on to the
 * new task's conversation.
 */
export function NewTaskDialog({
	onOpenChange,
	open,
}: {
	onOpenChange: (open: boolean) => void;
	open: boolean;
}) {
	const wizard = useWizardDraft();
	const [confirmingDiscard, setConfirmingDiscard] = useState(false);

	const closeAndReset = () => {
		setConfirmingDiscard(false);
		wizard.reset();
		onOpenChange(false);
	};
	const handleOpenChange = (next: boolean) => {
		if (next) {
			onOpenChange(true);
			return;
		}
		if (draftHasContent(wizard.draft)) {
			setConfirmingDiscard(true);
			return;
		}
		closeAndReset();
	};

	return (
		<>
			<Dialog onOpenChange={handleOpenChange} open={open}>
				<DialogContent className={CONTENT_CLASS}>
					<DialogHeader className="px-4 pt-4">
						<DialogTitle>New task</DialogTitle>
					</DialogHeader>
					<NewTaskWizard onStarted={closeAndReset} wizard={wizard} />
				</DialogContent>
			</Dialog>
			<DiscardConfirmDialog
				onDiscard={closeAndReset}
				onKeepEditing={() => setConfirmingDiscard(false)}
				open={confirmingDiscard}
			/>
		</>
	);
}
