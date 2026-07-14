import { Button } from "@better-agent/ui/components/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@better-agent/ui/components/popover";
import { Switch } from "@better-agent/ui/components/switch";
import { SlidersHorizontalIcon } from "lucide-react";
import { useEffect, useState } from "react";
import {
	type ClientPrefKey,
	setClientPref,
	useClientPref,
} from "@/utils/preferences";
import { toggleTheme } from "@/utils/theme";

// P2-T4: the workspace header's quick-settings popover — three client prefs
// (see utils/preferences.ts) plus the theme toggle, each a compact borderless
// label+switch row. Theme is NOT a pref: the row just reflects the <html>
// class and calls the existing `toggleTheme()` (utils/theme.ts).

/** One label+switch row. A plain div (not a <label>): the base-ui switch is
 * already its own labelled control, and wrapping it in a label would
 * double-fire the toggle on row clicks. */
function SettingRow({
	checked,
	label,
	onCheckedChange,
}: {
	checked: boolean;
	label: string;
	onCheckedChange: (checked: boolean) => void;
}) {
	return (
		<div className="flex items-center justify-between gap-3 rounded-md px-1.5 py-1">
			<span className="text-foreground text-xs">{label}</span>
			<Switch
				aria-label={label}
				checked={checked}
				onCheckedChange={onCheckedChange}
			/>
		</div>
	);
}

function PrefRow({
	label,
	prefKey,
}: {
	label: string;
	prefKey: ClientPrefKey;
}) {
	const checked = useClientPref(prefKey);
	return (
		<SettingRow
			checked={checked}
			label={label}
			onCheckedChange={(value) => setClientPref(prefKey, value)}
		/>
	);
}

/** Mirrors `ThemeToggle` (components/theme-toggle.tsx): current theme is read
 * from the <html> class after mount (SSR-safe), and the switch flips it via
 * the existing `toggleTheme()`. */
function ThemeRow() {
	const [isDark, setIsDark] = useState(false);
	useEffect(() => {
		setIsDark(document.documentElement.classList.contains("dark"));
	}, []);
	return (
		<SettingRow
			checked={isDark}
			label="Dark theme"
			onCheckedChange={() => setIsDark(toggleTheme() === "dark")}
		/>
	);
}

/** The quick-settings control itself: an icon button (next to the workspace
 * header's ⌘K) opening the popover of setting rows. */
export function QuickSettings() {
	return (
		<Popover>
			<PopoverTrigger
				render={
					<Button
						aria-label="Quick settings"
						className="shrink-0 text-muted-foreground"
						size="icon-sm"
						variant="ghost"
					/>
				}
			>
				<SlidersHorizontalIcon className="size-4" />
			</PopoverTrigger>
			<PopoverContent align="end" className="w-60 gap-1">
				<PrefRow label="Show thinking" prefKey="showThinking" />
				<PrefRow label="Show raw parameters" prefKey="showRawParameters" />
				<PrefRow label="Send with ⌃↵" prefKey="sendByCtrlEnter" />
				<ThemeRow />
			</PopoverContent>
		</Popover>
	);
}
