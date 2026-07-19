import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@better-agent/ui/components/select";

// The composer's individual control-menu primitives — split out of
// terminal-controls.tsx purely to keep that file under the repo's
// max-lines-per-file gate. `ControlSelect` is the shared trigger+menu shell;
// `OptionalControl` wraps it for menus that are hidden entirely when the agent
// reports no values; `resolveModelControl` is specific to the always-present
// model control's three-state fallback (switchable list / read-only label /
// disabled affordance).

/** Shown as the model control's tooltip when the agent hasn't reported any
 * model yet — so the always-present affordance explains its disabled state
 * rather than looking broken. */
export const NO_MODEL_REPORTED_TITLE =
	"This agent doesn't report a model list yet.";

export interface PickerOption {
	label: string;
	value: string;
}

interface ModelControlState {
	/** A read-only label to render in the trigger — the current model when the
	 * agent reports no switchable list (a disabled `Select` never mounts its
	 * items, so `SelectValue` can't resolve the label on its own). */
	displayLabel?: string;
	/** Whether the agent exposed a switchable list — drives whether the menu is
	 * interactive (a real dropdown) or a read-only label. */
	hasList: boolean;
	options: PickerOption[];
	title?: string;
}

/** Resolves what the always-present model control should show from whatever the
 * agent reported: the full switchable list, else just the current model as a
 * read-only label, else an empty "Model" affordance with an explanatory tip.
 * A current model MISSING from the reported list (claude's init line reports a
 * canonical id while the switchable list holds aliases; a startup config can
 * pin any id) is appended as its own option — the menu must always be able to
 * display and highlight what the session is actually on. */
export function resolveModelControl(
	model: string | undefined,
	models: string[] | undefined
): ModelControlState {
	if (models && models.length > 0) {
		const options = models.map((id) => ({ label: id, value: id }));
		if (model !== undefined && !models.includes(model)) {
			options.push({ label: model, value: model });
		}
		return { hasList: true, options };
	}
	if (model) {
		return {
			displayLabel: model,
			hasList: false,
			options: [{ label: model, value: model }],
		};
	}
	return { hasList: false, options: [], title: NO_MODEL_REPORTED_TITLE };
}

/** Borderless, compact trigger so the menus read as secondary composer
 * controls rather than form fields; capped width so a long model id truncates
 * instead of overflowing the toolbar on narrow viewports. */
const CONTROL_TRIGGER_CLASS =
	"h-7 max-w-40 border-0 bg-transparent px-2 text-muted-foreground shadow-none hover:bg-muted hover:text-foreground";

function firstStringValue(next: string | string[] | null): string | undefined {
	if (typeof next === "string") {
		return next;
	}
	return next?.[0];
}

interface ControlSelectProps {
	disabled: boolean;
	/** Explicit trigger text, overriding `SelectValue`'s own resolution — needed
	 * for a disabled menu whose items never mount (see `ModelControlState`). */
	displayLabel?: string;
	label: string;
	onChange: (value: string) => void;
	options: readonly PickerOption[];
	/** Native tooltip on the trigger — used to explain the model control's
	 * disabled state when the agent reports no model list. */
	title?: string;
	value?: string;
}

/** One compact composer menu, shared by the model and permission-mode
 * pickers — split out so `ComposerControls` stays under the repo's
 * max-lines-per-function gate. */
export function ControlSelect({
	disabled,
	displayLabel,
	label,
	onChange,
	options,
	title,
	value,
}: ControlSelectProps) {
	return (
		<Select
			disabled={disabled}
			// Lets `SelectValue` render the selected option's LABEL while the menu
			// is closed — without this base-ui shows the raw wire value (the popup's
			// items aren't mounted, so labels can't be resolved from them).
			items={options}
			onValueChange={(next) => {
				const picked = firstStringValue(next);
				if (picked) {
					onChange(picked);
				}
			}}
			// `?? null`, NOT undefined: `undefined` mounts base-ui's Select
			// UNCONTROLLED, and the real value arriving later (session_ready lands
			// after mount) is then ignored — the closed trigger showed the
			// placeholder forever instead of the session's current model/mode.
			value={value ?? null}
		>
			<SelectTrigger
				aria-label={label}
				className={CONTROL_TRIGGER_CLASS}
				size="sm"
				title={title}
			>
				<SelectValue placeholder={label}>
					{displayLabel ?? undefined}
				</SelectValue>
			</SelectTrigger>
			<SelectContent>
				{options.map((option) => (
					<SelectItem key={option.value} value={option.value}>
						{option.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

interface OptionalControlProps {
	disabled: boolean;
	label: string;
	onChange: (value: string) => void;
	options: readonly PickerOption[];
	title?: string;
	value?: string;
}

/** A `ControlSelect` that renders nothing once its `options` list is empty —
 * shared by the permission-mode and Thinking menus, both hidden entirely when
 * the agent reports no values for them. Split out purely to keep
 * `ComposerControls` under the repo's max-lines-per-function gate. */
export function OptionalControl({
	disabled,
	label,
	onChange,
	options,
	title,
	value,
}: OptionalControlProps) {
	if (options.length === 0) {
		return null;
	}
	return (
		<ControlSelect
			disabled={disabled}
			label={label}
			onChange={onChange}
			options={options}
			title={title}
			value={value}
		/>
	);
}
