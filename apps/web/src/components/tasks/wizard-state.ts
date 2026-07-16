import type { ComputerListItem } from "@/utils/api-types";

// Pure state transitions for the New Task wizard. The dependency rules are
// product contract (master spec §8.2/§18.2): Computer is upstream of Runtime,
// Runtime is upstream of the Skill Palette — switching an upstream choice
// must never leave a stale downstream one behind.

export type RuntimeInventoryItem = ComputerListItem["runtimeInventory"][number];
export type AgentKind = RuntimeInventoryItem["agentKind"];

export const WIZARD_STEPS = ["runtime", "request", "github"] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

/** Spec §8.3: Task Name is a UI label capped at 120 chars. */
export const TASK_NAME_MAX_LENGTH = 120;

export interface WizardDraft {
	agentKind: AgentKind | null;
	computerId: string | null;
	description: string;
	name: string;
	/** Skill names checked into the wizard's Skill Palette (spec §6.5). */
	paletteSkillNames: string[];
}

export const EMPTY_WIZARD_DRAFT: WizardDraft = {
	agentKind: null,
	computerId: null,
	description: "",
	name: "",
	paletteSkillNames: [],
};

export const hasVisibleText = (value: string): boolean =>
	value.trim().length > 0;

/** Step 2 gate: Name and Description are both required (spec §18.2). The
 * values themselves are kept verbatim — only advancing is blocked. */
export function requestStepComplete(draft: WizardDraft): boolean {
	return hasVisibleText(draft.name) && hasVisibleText(draft.description);
}

/**
 * Selecting a Computer clears an incompatible Runtime (spec §8.2) and always
 * resets the Palette — the Skill Inventory is per computer, so even a
 * still-compatible runtime's skills may differ on the new machine.
 */
export function withComputerSelected(
	draft: WizardDraft,
	computer: ComputerListItem
): WizardDraft {
	if (draft.computerId === computer.id) {
		return draft;
	}
	const runtimeStillAvailable =
		draft.agentKind !== null &&
		computer.runtimeInventory.some(
			(item) => item.agentKind === draft.agentKind
		);
	return {
		...draft,
		agentKind: runtimeStillAvailable ? draft.agentKind : null,
		computerId: computer.id,
		paletteSkillNames: [],
	};
}

/** Selecting a Runtime resets the Palette to the new Skill Inventory —
 * i.e. nothing checked (spec §8.2). */
export function withRuntimeSelected(
	draft: WizardDraft,
	agentKind: AgentKind
): WizardDraft {
	if (draft.agentKind === agentKind) {
		return draft;
	}
	return { ...draft, agentKind, paletteSkillNames: [] };
}

/** Checking/unchecking a Palette skill touches ONLY the palette — never the
 * Description (spec §6.5). */
export function withPaletteSkillToggled(
	draft: WizardDraft,
	skillName: string,
	checked: boolean
): WizardDraft {
	const withoutSkill = draft.paletteSkillNames.filter(
		(name) => name !== skillName
	);
	return {
		...draft,
		paletteSkillNames: checked ? [...withoutSkill, skillName] : withoutSkill,
	};
}

export function selectedRuntime(
	computer: ComputerListItem | undefined,
	agentKind: AgentKind | null
): RuntimeInventoryItem | null {
	if (!computer || agentKind === null) {
		return null;
	}
	return (
		computer.runtimeInventory.find((item) => item.agentKind === agentKind) ??
		null
	);
}

/** The checked palette resolved back to full skill summaries — the ONLY
 * candidate source for the Description's "/" autocomplete (spec §8.3). */
export function paletteSkills(
	runtime: RuntimeInventoryItem | null,
	paletteSkillNames: string[]
): RuntimeInventoryItem["skills"] {
	if (!runtime) {
		return [];
	}
	return runtime.skills.filter((skill) =>
		paletteSkillNames.includes(skill.name)
	);
}
