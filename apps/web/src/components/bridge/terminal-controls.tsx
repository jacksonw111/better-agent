import {
	ControlSelect,
	OptionalControl,
	type PickerOption,
	resolveModelControl,
	UNRESOLVED_VALUE_PLACEHOLDER,
	UNRESOLVED_VALUE_TITLE,
} from "./terminal-control-select";

// The composer's bottom-right control menus (relocated out of the header per
// the owner's feedback): a model menu and a permission-mode menu, sitting next
// to Send/Stop. Deliberately quiet — small, borderless, secondary triggers that
// match a modern chat composer rather than a hardcoded control strip. The MODEL
// control is ALWAYS present (never fully hidden) so the owner can always see
// what the agent is on, reflecting whatever the agent reports: the full list
// when it exposes `models`, just the current model when it reports only
// `model`, and a disabled "Model" affordance when it reports neither. The
// permission-mode menu stays capability-gated. The individual menu primitives
// (`ControlSelect`/`OptionalControl`/`resolveModelControl`) live in
// `terminal-control-select.tsx`, split out purely to keep this file under the
// repo's max-lines-per-file gate.

/** Human labels for the wire `permissionMode` values across agents —
 * claude's SDK `PermissionMode` enum plus opencode's ACP `build`/`plan`
 * (codex's launch-only approval_policy isn't surfaced as a menu, see
 * agent-capabilities.ts). Any mode not listed falls back to its raw value. */
const PERMISSION_MODE_LABELS: Record<string, string> = {
	default: "Default",
	acceptEdits: "Accept edits",
	bypassPermissions: "Bypass permissions",
	plan: "Plan",
	dontAsk: "Don't ask",
	auto: "Auto",
	build: "Build",
};

/** Human labels for pi's `set_thinking_level` vocabulary (see
 * `PI_THINKING_LEVELS` in `apps/bridge-cli/src/normalize/pi-commands.ts`).
 * Any level not listed falls back to its raw value, same fallback shape as
 * `PERMISSION_MODE_LABELS`. */
const THINKING_LEVEL_LABELS: Record<string, string> = {
	off: "Off",
	minimal: "Minimal",
	low: "Low",
	medium: "Medium",
	high: "High",
	xhigh: "Extra high",
	max: "Max",
};

/** codex's `setModel`/`setPermissionMode` apply to the NEXT turn only
 * (`codexTurnStartParams`, R2-T2) rather than the live one — this tooltip
 * makes that per-turn semantics visible on both menus rather than implying
 * an immediate effect the way claude/opencode's menus have. */
const NEXT_TURN_HINT_TITLE = "下一回合生效";

/** Maps a menu's raw wire values to `{ label, value }` options via a
 * label-lookup table, falling back to the raw value for anything unlisted —
 * shared by the permission-mode and Thinking menus. Split out purely to keep
 * `ComposerControls` under the repo's max-lines-per-function gate. */
function buildLabeledOptions(
	values: readonly string[],
	labels: Record<string, string>
): PickerOption[] {
	return values.map((value) => ({ label: labels[value] ?? value, value }));
}

/** Appends the session's CURRENT value when it isn't among the offered ones —
 * a task session can start in a mode the menu deliberately doesn't offer
 * (e.g. `bypassPermissions` via a persisted startup config), and the closed
 * trigger must still display it as the current value rather than rendering
 * blank. Picking it back is a no-op switch to the mode already active, so
 * this never widens what a user can escalate INTO. */
function withCurrentOption(
	options: PickerOption[],
	current: string | undefined,
	labels: Record<string, string>
): PickerOption[] {
	if (current === undefined || options.some((o) => o.value === current)) {
		return options;
	}
	return [...options, { label: labels[current] ?? current, value: current }];
}

/** The permission menu's options: the agent's offered modes, plus the
 * session's current mode when it isn't offered — split out of
 * `ComposerControls` purely for the max-lines-per-function gate. */
function permissionOptionsFor(
	permissionModes: readonly string[],
	permissionMode: string | undefined
): PickerOption[] {
	return withCurrentOption(
		buildLabeledOptions(permissionModes, PERMISSION_MODE_LABELS),
		permissionMode,
		PERMISSION_MODE_LABELS
	);
}

/** The tooltip for a control whose current value is still unknown — paired
 * with `UNRESOLVED_VALUE_PLACEHOLDER`, and undefined once a value is known so
 * the caller can fall back to its usual tooltip. */
function unresolvedTitle(value: string | undefined): string | undefined {
	return value === undefined ? UNRESOLVED_VALUE_TITLE : undefined;
}

/** `unresolvedTitle`'s twin for the trigger text. */
function unresolvedPlaceholder(value: string | undefined): string | undefined {
	return value === undefined ? UNRESOLVED_VALUE_PLACEHOLDER : undefined;
}

/** The model menu's value-dependent props. Split out for the
 * max-lines-per-function gate. The placeholder covers the case where the agent
 * reported a switchable list but no CURRENT model (a resumed session, whose
 * SDK can't be asked what it's on): the menu works, it just has nothing
 * selected — say so rather than showing a bare "Model" that reads as a chosen
 * value. */
function modelSelectProps(
	control: ReturnType<typeof resolveModelControl>,
	model: string | undefined
) {
	return {
		displayLabel: control.displayLabel,
		label: "Model",
		options: control.options,
		placeholder: control.hasList ? unresolvedPlaceholder(model) : undefined,
		value: model,
	};
}

export interface ComposerControlsProps {
	/** Disables both menus — mirrors the composer's `disabled` (no live session
	 * to relay a control command to). */
	disabled: boolean;
	/** The session's currently-active model (from `session_ready`), highlighted
	 * in the menu. */
	model?: string;
	/** The model ids the agent reports it can switch between (`session_ready`'s
	 * `models`). When present the menu lists exactly these; when empty/absent the
	 * always-present model control falls back to the current model or a disabled
	 * affordance (see `resolveModelControl`). */
	models?: string[];
	onSetModel: (model: string) => void;
	onSetPermissionMode: (mode: string) => void;
	onSetThinking: (level: string) => void;
	/** The session's currently-active permission mode (from `session_ready`). */
	permissionMode?: string;
	/** The permission-mode values this agent accepts (its capability's
	 * `permissionModes`); the menu is hidden entirely when empty. */
	permissionModes: readonly string[];
	/** True for a codex session — codex's `setModel`/`setPermissionMode` apply
	 * on the NEXT turn (R2-T2's per-turn `codexTurnStartParams`), not live, so
	 * the model/permission menus grow an explanatory tooltip rather than
	 * looking like every other agent's immediate-effect menu. */
	showNextTurnHint?: boolean;
	/** pi's `set_thinking_level` vocabulary (R2-T1's live capability handshake,
	 * `thinkingLevels`) — the Thinking menu is hidden entirely when empty, same
	 * gating shape as `permissionModes`. There's no reported "current level" on
	 * `session_ready` yet, so the menu stays uncontrolled (placeholder only). */
	thinkingLevels: readonly string[];
}

/**
 * The composer toolbar's bottom-right menus: an always-present model control
 * (a switchable dropdown when the agent reports `models`, the current model as
 * a read-only label when it reports only `model`, and a disabled "Model"
 * affordance otherwise) and a capability-gated permission-mode menu (rendered
 * only when the agent accepts any `permissionModes`). The model control is
 * never fully hidden, so the owner can always see what the agent is on.
 */
export function ComposerControls({
	disabled,
	model,
	models,
	onSetModel,
	onSetPermissionMode,
	onSetThinking,
	permissionMode,
	permissionModes,
	showNextTurnHint,
	thinkingLevels,
}: ComposerControlsProps) {
	const modelControl = resolveModelControl(model, models);
	const permissionOptions = permissionOptionsFor(
		permissionModes,
		permissionMode
	);
	const thinkingOptions = buildLabeledOptions(
		thinkingLevels,
		THINKING_LEVEL_LABELS
	);
	const nextTurnHint = showNextTurnHint ? NEXT_TURN_HINT_TITLE : undefined;
	return (
		<>
			<ControlSelect
				{...modelSelectProps(modelControl, model)}
				disabled={disabled || !modelControl.hasList}
				onChange={onSetModel}
				title={modelControl.title ?? unresolvedTitle(model) ?? nextTurnHint}
			/>
			<OptionalControl
				disabled={disabled}
				label="Permission mode"
				onChange={onSetPermissionMode}
				options={permissionOptions}
				placeholder={unresolvedPlaceholder(permissionMode)}
				title={unresolvedTitle(permissionMode) ?? nextTurnHint}
				value={permissionMode}
			/>
			<OptionalControl
				disabled={disabled}
				label="Thinking"
				onChange={onSetThinking}
				options={thinkingOptions}
			/>
		</>
	);
}
