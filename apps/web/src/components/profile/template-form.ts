import type { ProjectTemplate } from "@/utils/api-types";

export interface ScaffoldFile {
	content: string;
	path: string;
}

export interface TemplateFormState {
	claudeMd: string;
	description: string;
	dirs: string[];
	files: ScaffoldFile[];
	mcpServerIds: string[];
	name: string;
}

export const EMPTY_TEMPLATE_FORM: TemplateFormState = {
	claudeMd: "",
	description: "",
	dirs: [],
	files: [],
	mcpServerIds: [],
	name: "",
};

export function templateToForm(template: ProjectTemplate): TemplateFormState {
	return {
		claudeMd: template.claudeMd ?? "",
		description: template.description ?? "",
		dirs: [...template.scaffold.dirs],
		files: template.scaffold.files.map((file) => ({ ...file })),
		mcpServerIds: [...template.mcpServerIds],
		name: template.name,
	};
}

export function isTemplateFormValid(form: TemplateFormState): boolean {
	return form.name.trim().length > 0;
}

/** Builds the `profiles.templates.*` payload: drops blank-path files and blank
 * dirs, and collapses empty description / CLAUDE.md to null so a cleared field
 * round-trips as "unset" rather than an empty string. */
export function toTemplateInput(form: TemplateFormState) {
	const description = form.description.trim();
	const claudeMd = form.claudeMd.trim();
	return {
		claudeMd: claudeMd.length > 0 ? claudeMd : null,
		description: description.length > 0 ? description : null,
		mcpServerIds: form.mcpServerIds,
		name: form.name.trim(),
		scaffold: {
			dirs: form.dirs.map((dir) => dir.trim()).filter((dir) => dir.length > 0),
			files: form.files
				.filter((file) => file.path.trim().length > 0)
				.map((file) => ({ content: file.content, path: file.path.trim() })),
		},
	};
}
