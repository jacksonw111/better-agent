import {
	ControlSelect,
	OptionalControl,
	type PickerOption,
	resolveModelControl,
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
	const permissionOptions = buildLabeledOptions(
		permissionModes,
		PERMISSION_MODE_LABELS
	);
	const thinkingOptions = buildLabeledOptions(
		thinkingLevels,
		THINKING_LEVEL_LABELS
	);
	const nextTurnHint = showNextTurnHint ? NEXT_TURN_HINT_TITLE : undefined;
	return (
		<>
			<ControlSelect
				disabled={disabled || !modelControl.hasList}
				displayLabel={modelControl.displayLabel}
				label="Model"
				onChange={onSetModel}
				options={modelControl.options}
				title={modelControl.title ?? nextTurnHint}
				value={model}
			/>
			<OptionalControl
				disabled={disabled}
				label="Permission mode"
				onChange={onSetPermissionMode}
				options={permissionOptions}
				title={nextTurnHint}
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
