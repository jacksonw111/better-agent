import { Switch } from "@better-agent/ui/components/switch";

// One label+switch row of the quick-settings popover (P2-T4), extracted from
// quick-settings.tsx so feature rows in other files (e.g. the P3-T3 push
// notifications row) can reuse it without an import cycle.

/** A plain div (not a <label>): the base-ui switch is already its own
 * labelled control, and wrapping it in a label would double-fire the toggle
 * on row clicks. */
export function SettingRow({
	checked,
	disabled,
	label,
	onCheckedChange,
}: {
	checked: boolean;
	disabled?: boolean;
	label: string;
	onCheckedChange: (checked: boolean) => void;
}) {
	return (
		<div className="flex items-center justify-between gap-3 rounded-md px-1.5 py-1">
			<span className="text-foreground text-xs">{label}</span>
			<Switch
				aria-label={label}
				checked={checked}
				disabled={disabled}
				onCheckedChange={onCheckedChange}
			/>
		</div>
	);
}
