import type { AgentRow } from "@/utils/api-types";

export interface AgentForm {
	builtinTools: string[];
	composioAccountIds: string[];
	description: string;
	maxOutputTokens: string;
	mcpServerIds: string[];
	/** Deferred memory assignments: only used when CREATING (assigned with role
	 * read after the agent exists). Editing manages assignments live instead. */
	memoryIds: string[];
	modelId: string;
	name: string;
	providerId: string;
	systemPrompt: string;
	temperature: string;
	toolAllowlist: string[] | null;
	topP: string;
}

export const EMPTY_AGENT_FORM: AgentForm = {
	composioAccountIds: [],
	builtinTools: [],
	mcpServerIds: [],
	memoryIds: [],
	name: "",
	description: "",
	systemPrompt: "",
	providerId: "",
	modelId: "",
	temperature: "",
	topP: "",
	maxOutputTokens: "",
	toolAllowlist: null,
};

export const WIZARD_STEPS = [
	"Identity",
	"Model",
	"Params",
	"Tools",
	"Memories",
] as const;

const IDENTITY_STEP = 0;
const MODEL_STEP = 1;
const LAST_STEP = WIZARD_STEPS.length - 1;

export function isStepValid(step: number, form: AgentForm): boolean {
	if (step === IDENTITY_STEP) {
		return (
			form.name.trim() !== "" &&
			form.description.trim() !== "" &&
			form.systemPrompt.trim() !== ""
		);
	}
	if (step === MODEL_STEP) {
		return form.providerId !== "" && form.modelId !== "";
	}
	return true;
}

export function isLastStep(step: number): boolean {
	return step === LAST_STEP;
}

function toNumber(value: string): number | null {
	const trimmed = value.trim();
	if (trimmed === "") {
		return null;
	}
	const parsed = Number(trimmed);
	return Number.isFinite(parsed) ? parsed : null;
}

function toParams(form: AgentForm) {
	const temperature = toNumber(form.temperature);
	const topP = toNumber(form.topP);
	const maxOutputTokens = toNumber(form.maxOutputTokens);
	if (temperature === null && topP === null && maxOutputTokens === null) {
		return null;
	}
	return { temperature, topP, maxOutputTokens };
}

export function toAgentInput(form: AgentForm) {
	return {
		composioAccountIds: form.composioAccountIds,
		builtinTools: form.builtinTools,
		mcpServerIds: form.mcpServerIds,
		name: form.name,
		description: form.description,
		systemPrompt: form.systemPrompt,
		providerId: form.providerId,
		modelId: form.modelId,
		params: toParams(form),
		toolAllowlist: form.toolAllowlist,
	};
}

function numToStr(value: number | null | undefined): string {
	return value?.toString() ?? "";
}

export function agentRowToForm(row: AgentRow): AgentForm {
	return {
		composioAccountIds: row.composioAccountIds ?? [],
		builtinTools: row.builtinTools ?? [],
		mcpServerIds: row.mcpServerIds ?? [],
		memoryIds: [],
		name: row.name,
		description: row.description,
		systemPrompt: row.systemPrompt,
		providerId: row.providerId,
		modelId: row.modelId,
		temperature: numToStr(row.params?.temperature),
		topP: numToStr(row.params?.topP),
		maxOutputTokens: numToStr(row.params?.maxOutputTokens),
		toolAllowlist: row.toolAllowlist ?? null,
	};
}
