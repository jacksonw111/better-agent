import { Input } from "@better-agent/ui/components/input";
import { Label } from "@better-agent/ui/components/label";
import { Textarea } from "@better-agent/ui/components/textarea";
import { McpServersField } from "@/components/agents/mcp-servers-field";
import type { SkillFormState } from "./skill-form";

const INSTRUCTIONS_ROWS = 6;

interface FieldProps {
	form: SkillFormState;
	onChange: (patch: Partial<SkillFormState>) => void;
}

/** Name, description, and instructions — the skill's required identity. */
function SkillIdentityFields({ form, onChange }: FieldProps) {
	return (
		<>
			<div className="flex flex-col gap-2">
				<Label htmlFor="skill-name">Name</Label>
				<Input
					id="skill-name"
					onChange={(event) => onChange({ name: event.target.value })}
					placeholder="e.g. Deploy the app"
					value={form.name}
				/>
			</div>
			<div className="flex flex-col gap-2">
				<Label htmlFor="skill-description">Description</Label>
				<Input
					id="skill-description"
					onChange={(event) => onChange({ description: event.target.value })}
					placeholder="Shown in the skill list and the /skill picker"
					value={form.description}
				/>
			</div>
			<div className="flex flex-col gap-2">
				<Label htmlFor="skill-instructions">Instructions</Label>
				<Textarea
					id="skill-instructions"
					onChange={(event) => onChange({ instructions: event.target.value })}
					placeholder="The playbook the agent follows when this skill activates"
					rows={INSTRUCTIONS_ROWS}
					value={form.instructions}
				/>
			</div>
		</>
	);
}

/** Optional allowedTools (v1: a plain newline-separated textarea — no
 * canonical tool catalog exists to pick from, see skill-form.ts) and
 * mcpServerIds (reuses the same McpServersField the agent wizard's Tools
 * step uses). */
function SkillToolsFields({ form, onChange }: FieldProps) {
	return (
		<>
			<div className="flex flex-col gap-2">
				<Label htmlFor="skill-allowed-tools">Allowed tools (optional)</Label>
				<Textarea
					id="skill-allowed-tools"
					onChange={(event) => onChange({ allowedTools: event.target.value })}
					placeholder="One tool name per line — leave blank to allow all"
					value={form.allowedTools}
				/>
			</div>
			<div className="flex flex-col gap-2">
				<Label>MCP servers (optional)</Label>
				<McpServersField
					onChange={(ids) => onChange({ mcpServerIds: ids })}
					selected={form.mcpServerIds}
				/>
			</div>
		</>
	);
}

/** The name/description/instructions/tools fields shared by the create and
 * edit skill dialogs. */
export function SkillFormFields({ form, onChange }: FieldProps) {
	return (
		<>
			<SkillIdentityFields form={form} onChange={onChange} />
			<SkillToolsFields form={form} onChange={onChange} />
		</>
	);
}
