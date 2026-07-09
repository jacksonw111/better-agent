import { cn } from "@better-agent/ui/lib/utils";
import type { SkillPickerItem } from "./skill-picker";

interface SkillPickerRowProps {
	active: boolean;
	itemId: string;
	onHover: () => void;
	onSelect: () => void;
	skill: SkillPickerItem;
}

function SkillPickerRow({
	active,
	itemId,
	onHover,
	onSelect,
	skill,
}: SkillPickerRowProps) {
	// An explicit aria-label pins the accessible NAME to just the skill name
	// (the button's default "name from content" would otherwise concatenate
	// the name and description spans with no separating whitespace, since
	// they're adjacent block elements). The description is exposed
	// separately via aria-describedby, so a screen reader still announces it
	// right after the name — the same name/description split sighted users
	// get from the two visually distinct lines.
	const descriptionId = `${itemId}-description`;
	return (
		<button
			aria-describedby={descriptionId}
			aria-label={skill.name}
			aria-selected={active}
			className={cn(
				"flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left text-sm",
				active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"
			)}
			id={itemId}
			onMouseDown={(event) => {
				// Selecting via the mouse must not first blur the textarea (which
				// would fire before `onClick`) — mousedown is the earliest point we
				// can intercept, so preventDefault here keeps focus in place.
				event.preventDefault();
				onSelect();
			}}
			onMouseEnter={onHover}
			role="option"
			type="button"
		>
			<span className="flex items-center gap-1.5">
				<span aria-hidden className="text-muted-foreground">
					/
				</span>
				{skill.name}
			</span>
			<span
				className="truncate text-muted-foreground text-xs"
				id={descriptionId}
			>
				{skill.description}
			</span>
		</button>
	);
}

export interface SkillPickerListProps {
	activeIndex: number;
	itemDomId: (index: number) => string;
	items: SkillPickerItem[];
	listId: string;
	onHover: (index: number) => void;
	onSelect: (item: SkillPickerItem) => void;
}

/**
 * The web chat composer's "/" picker dropdown: the agent's assigned skills,
 * name plus one-line description, scrolling once the list outgrows its max
 * height. Renders directly above the composer box (`bottom-full`) since the
 * composer sits pinned to the bottom of the chat view. Mirrors the bridge
 * terminal's SlashPickerList (apps/web/src/components/bridge/
 * slash-picker-list.tsx) minus the command/skill grouping — a web chat
 * message only ever invokes a skill. Purely presentational —
 * filtering/keyboard-nav state lives in `use-skill-picker`.
 */
export function SkillPickerList({
	activeIndex,
	itemDomId,
	items,
	listId,
	onHover,
	onSelect,
}: SkillPickerListProps) {
	return (
		<div
			className="absolute inset-x-0 bottom-full z-20 mb-2 max-h-64 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
			id={listId}
			role="listbox"
		>
			{items.map((item, index) => (
				<SkillPickerRow
					active={index === activeIndex}
					itemId={itemDomId(index)}
					key={item.name}
					onHover={() => onHover(index)}
					onSelect={() => onSelect(item)}
					skill={item}
				/>
			))}
		</div>
	);
}
