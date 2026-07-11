import { Label } from "@better-agent/ui/components/label";
import { SkillPicker } from "../skills/skill-picker";
import type { ConfigDraft } from "./local-agent-config-form";

// R5-T2: the local-agent Config tab's skills picker, split out of
// local-agent-config-form.tsx to keep that file under the repo's 300-line
// limit (same pattern as local-agent-mcp-field.tsx). Reuses SkillPicker
// (apps/web/src/components/skills/skill-picker.tsx) — the same multi-select
// agents use to assign their own skills.

interface FieldProps {
	draft: ConfigDraft;
	onDraft: (next: ConfigDraft) => void;
}

/** Assigns the user's skills to this local-agent token. Shown for every agent
 * kind — the server resolves the assignment into ready-to-use
 * `{name,description,instructions}` skills regardless (see
 * `bridge-skills-resolve.ts`); claude-code already applies them at launch
 * (writes SKILL.md, enables the SDK `skills` option), other adapters persist
 * but ignore them for now. Skills only apply at session start, so an edit
 * here always needs a restart (see `RESTART_REQUIRED_FIELDS` in
 * local-agent-settings-dialog.tsx). */
export function SkillsConfigField({ draft, onDraft }: FieldProps) {
	return (
		<div className="flex flex-col gap-2">
			<Label>Skills</Label>
			<SkillPicker
				onChange={(ids) => onDraft({ ...draft, skillIds: ids })}
				selected={draft.skillIds}
			/>
			<p className="text-muted-foreground text-xs">
				Applied on the next session start — restart the agent (or reconnect) to
				pick up changes.
			</p>
		</div>
	);
}
