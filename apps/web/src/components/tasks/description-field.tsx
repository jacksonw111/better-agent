import type { SkillPickerItem } from "@better-agent/ui/components/chat/skill-picker";
import { SkillPickerList } from "@better-agent/ui/components/chat/skill-picker-list";
import { Label } from "@better-agent/ui/components/label";
import { Textarea } from "@better-agent/ui/components/textarea";
import { useId } from "react";
import { useDescriptionSlashPicker } from "./use-description-slash-picker";

interface DescriptionFieldProps {
	error: string | null;
	onChange: (value: string) => void;
	/** Palette-checked skills — the only "/" autocomplete candidates. */
	skills: SkillPickerItem[];
	value: string;
}

/**
 * The wizard's Task Description editor: a plain textarea whose "/" token at
 * the cursor opens the palette-only autocomplete (rendered with the chat
 * composer's SkillPickerList). The Description itself stays verbatim text —
 * the picker only ever inserts `/skill-name ` where the user asked for it.
 */
export function DescriptionField({
	error,
	onChange,
	skills,
	value,
}: DescriptionFieldProps) {
	const fieldId = useId();
	const picker = useDescriptionSlashPicker({ onChange, skills, value });
	return (
		<div className="flex flex-col gap-1.5">
			<Label htmlFor={fieldId}>Task description</Label>
			<div className="relative">
				{picker.open ? (
					<SkillPickerList
						activeIndex={picker.activeIndex}
						itemDomId={picker.itemDomId}
						items={picker.items}
						listId={picker.listId}
						onHover={picker.setActiveIndex}
						onSelect={picker.select}
					/>
				) : null}
				<Textarea
					aria-invalid={error === null ? undefined : true}
					className="min-h-32"
					id={fieldId}
					onChange={picker.handleChange}
					onKeyDown={picker.handleKeyDown}
					onSelect={picker.handleSelectionChange}
					placeholder="What should the agent do? Type / to reference a palette skill."
					ref={picker.textareaRef}
					value={value}
				/>
			</div>
			{error === null ? null : (
				<p className="text-destructive text-xs">{error}</p>
			)}
		</div>
	);
}
