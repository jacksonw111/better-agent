import type { SkillPickerItem } from "@better-agent/ui/components/chat/skill-picker";
import { Input } from "@better-agent/ui/components/input";
import { Label } from "@better-agent/ui/components/label";
import { useId } from "react";
import { DescriptionField } from "./description-field";
import type { WizardDraft } from "./wizard-state";
import { hasVisibleText, TASK_NAME_MAX_LENGTH } from "./wizard-state";

// Step 2 (Request) of the New Task wizard — master spec §8.3. Name and
// Description are both required; validation messages appear only after an
// attempted advance (errorsVisible) so the empty form doesn't open shouting.

export function WizardStepRequest({
	draft,
	errorsVisible,
	onDescriptionChange,
	onNameChange,
	paletteSkills,
}: {
	draft: WizardDraft;
	errorsVisible: boolean;
	onDescriptionChange: (value: string) => void;
	onNameChange: (value: string) => void;
	paletteSkills: SkillPickerItem[];
}) {
	const nameId = useId();
	const nameError =
		errorsVisible && !hasVisibleText(draft.name)
			? "Task name is required"
			: null;
	const descriptionError =
		errorsVisible && !hasVisibleText(draft.description)
			? "Task description is required"
			: null;
	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-1.5">
				<Label htmlFor={nameId}>Task name</Label>
				<Input
					aria-invalid={nameError === null ? undefined : true}
					id={nameId}
					maxLength={TASK_NAME_MAX_LENGTH}
					onChange={(event) => onNameChange(event.target.value)}
					placeholder="A label for the task list — it never reaches the agent"
					value={draft.name}
				/>
				{nameError === null ? null : (
					<p className="text-destructive text-xs">{nameError}</p>
				)}
			</div>
			<DescriptionField
				error={descriptionError}
				onChange={onDescriptionChange}
				skills={paletteSkills}
				value={draft.description}
			/>
		</div>
	);
}
