import { Input } from "@better-agent/ui/components/input";
import { Label } from "@better-agent/ui/components/label";
import { McpServersField } from "@/components/agents/mcp-servers-field";
import { MarkdownField } from "./markdown-field";
import { ScaffoldEditor } from "./scaffold-editor";
import type { TemplateFormState } from "./template-form";

interface FieldsProps {
	form: TemplateFormState;
	onChange: (patch: Partial<TemplateFormState>) => void;
}

/** Name + description — a template's identity. */
function TemplateIdentityFields({ form, onChange }: FieldsProps) {
	return (
		<>
			<div className="flex flex-col gap-2">
				<Label htmlFor="template-name">Name</Label>
				<Input
					id="template-name"
					onChange={(event) => onChange({ name: event.target.value })}
					placeholder="e.g. Node service"
					value={form.name}
				/>
			</div>
			<div className="flex flex-col gap-2">
				<Label htmlFor="template-description">Description</Label>
				<Input
					id="template-description"
					onChange={(event) => onChange({ description: event.target.value })}
					placeholder="Shown when you pick a template for a new project"
					value={form.description}
				/>
			</div>
		</>
	);
}

/** The full template editor body: identity, scaffold, project CLAUDE.md, and
 * the project-level MCP servers to seed. */
export function TemplateFields({ form, onChange }: FieldsProps) {
	return (
		<>
			<TemplateIdentityFields form={form} onChange={onChange} />
			<ScaffoldEditor
				dirs={form.dirs}
				files={form.files}
				onDirsChange={(dirs) => onChange({ dirs })}
				onFilesChange={(files) => onChange({ files })}
			/>
			<MarkdownField
				id="template-claude-md"
				label="Project CLAUDE.md (optional)"
				onChange={(claudeMd) => onChange({ claudeMd })}
				placeholder="Extra instructions layered on top of your global standards for this project…"
				value={form.claudeMd}
			/>
			<div className="flex flex-col gap-2">
				<Label>Project MCP servers (optional)</Label>
				<McpServersField
					onChange={(mcpServerIds) => onChange({ mcpServerIds })}
					selected={form.mcpServerIds}
				/>
			</div>
		</>
	);
}
