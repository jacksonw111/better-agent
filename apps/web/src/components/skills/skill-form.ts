import type { SkillRow } from "./skill-types";

// The skill create/edit form's draft state. `allowedTools` is kept as raw
// newline-separated text in the form (v1 keeps this simple — no canonical
// tool catalog exists to pick from, unlike mcpServerIds which reuses
// McpServersField) and only parsed into an array at submit time.

export interface SkillFormState {
	allowedTools: string;
	description: string;
	instructions: string;
	mcpServerIds: string[];
	name: string;
}

export const EMPTY_SKILL_FORM: SkillFormState = {
	allowedTools: "",
	description: "",
	instructions: "",
	mcpServerIds: [],
	name: "",
};

export function skillRowToForm(row: SkillRow): SkillFormState {
	return {
		allowedTools: (row.allowedTools ?? []).join("\n"),
		description: row.description ?? "",
		instructions: row.instructions ?? "",
		mcpServerIds: row.mcpServerIds ?? [],
		name: row.name,
	};
}

function parseAllowedTools(raw: string): string[] | undefined {
	const tools = raw
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");
	return tools.length > 0 ? tools : undefined;
}

/** The create/update payload for a skill form: trims text fields and drops
 * empty optional lists so they come through as `undefined` (unset), not `[]`. */
export function toSkillInput(form: SkillFormState) {
	return {
		allowedTools: parseAllowedTools(form.allowedTools),
		description: form.description.trim(),
		instructions: form.instructions.trim(),
		mcpServerIds: form.mcpServerIds.length > 0 ? form.mcpServerIds : undefined,
		name: form.name.trim(),
	};
}

export function isSkillFormValid(form: SkillFormState): boolean {
	return (
		form.name.trim() !== "" &&
		form.description.trim() !== "" &&
		form.instructions.trim() !== ""
	);
}
