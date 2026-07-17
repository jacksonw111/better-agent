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

/** The Step 3 repository selection (S4-T2, spec §6.14): just the identity the
 * Start payload needs plus the URL shown in the picker. */
export interface WizardRepository {
	fullName: string;
	url: string;
}

/** A linked issue in the wizard (spec §6.15) — number for the Start payload,
 * title for display. Order is the user's add order. */
export interface WizardIssue {
	number: number;
	title: string;
}

export interface WizardDraft {
	agentKind: AgentKind | null;
	computerId: string | null;
	description: string;
	/** Linked issues, in add order (spec §8.4) — only valid with a repository. */
	issues: WizardIssue[];
	name: string;
	/** Skill names checked into the wizard's Skill Palette (spec §6.5). */
	paletteSkillNames: string[];
	repository: WizardRepository | null;
}

export const EMPTY_WIZARD_DRAFT: WizardDraft = {
	agentKind: null,
	computerId: null,
	description: "",
	issues: [],
	name: "",
	paletteSkillNames: [],
	repository: null,
};

/** The draft a fresh wizard opens with. A `defaultComputerId` (the Computer
 * detail page's New Task button) pre-fills Step 1's Computer — still
 * changeable, and NOT "content" for the discard prompt (see draftHasContent's
 * `initial` parameter). */
export function initialWizardDraft(defaultComputerId?: string): WizardDraft {
	if (defaultComputerId === undefined) {
		return EMPTY_WIZARD_DRAFT;
	}
	return { ...EMPTY_WIZARD_DRAFT, computerId: defaultComputerId };
}

export const hasVisibleText = (value: string): boolean =>
	value.trim().length > 0;

/** Step 2 gate: Name and Description are both required (spec §18.2). The
 * values themselves are kept verbatim — only advancing is blocked. */
export function requestStepComplete(draft: WizardDraft): boolean {
	return hasVisibleText(draft.name) && hasVisibleText(draft.description);
}

/** True once any field differs from the draft the wizard opened with. The
 * New Task modal only asks "Discard this task?" on close when this is true —
 * closing an untouched wizard should never nag, including one whose Computer
 * was merely pre-selected (`initial` from initialWizardDraft). */
export function draftHasContent(
	draft: WizardDraft,
	initial: WizardDraft = EMPTY_WIZARD_DRAFT
): boolean {
	return (
		draft.computerId !== initial.computerId ||
		draft.agentKind !== null ||
		hasVisibleText(draft.name) ||
		hasVisibleText(draft.description) ||
		draft.paletteSkillNames.length > 0 ||
		draft.repository !== null ||
		draft.issues.length > 0
	);
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

/** Issues must come from the selected repository (spec §8.4): switching to a
 * DIFFERENT repository clears them; re-selecting the same one keeps them. */
export function withRepositorySelected(
	draft: WizardDraft,
	repository: WizardRepository
): WizardDraft {
	if (draft.repository?.fullName === repository.fullName) {
		return { ...draft, repository };
	}
	return { ...draft, issues: [], repository };
}

/** Clearing the repository always clears the issues with it (spec §8.4). */
export function withRepositoryCleared(draft: WizardDraft): WizardDraft {
	return { ...draft, issues: [], repository: null };
}

/** Appends a linked issue, keeping add order; a duplicate number is a no-op. */
export function withIssueAdded(
	draft: WizardDraft,
	issue: WizardIssue
): WizardDraft {
	if (draft.issues.some((existing) => existing.number === issue.number)) {
		return draft;
	}
	return { ...draft, issues: [...draft.issues, issue] };
}

export function withIssueRemoved(
	draft: WizardDraft,
	issueNumber: number
): WizardDraft {
	return {
		...draft,
		issues: draft.issues.filter((issue) => issue.number !== issueNumber),
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
