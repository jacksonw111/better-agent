import {
	DropdownMenuCheckboxItem,
	DropdownMenuItem,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
} from "@better-agent/ui/components/dropdown-menu";

import type { ToolGroup } from "./tool-allowlist-groups";

function GroupBulkActions({
	group,
	onToggleGroup,
}: {
	group: ToolGroup;
	onToggleGroup: (group: ToolGroup, checked: boolean) => void;
}) {
	return (
		<div className="flex gap-1 px-1 py-1">
			<DropdownMenuItem
				className="flex-1 justify-center"
				closeOnClick={false}
				onClick={() => onToggleGroup(group, true)}
			>
				Select all
			</DropdownMenuItem>
			<DropdownMenuItem
				className="flex-1 justify-center"
				closeOnClick={false}
				onClick={() => onToggleGroup(group, false)}
			>
				Clear
			</DropdownMenuItem>
		</div>
	);
}

// Level 2 of the cascade: the group's tools as checkbox rows. Submenu hover
// uses base-ui's built-in safe-polygon intent (the "safe triangle"), so
// diagonal cursor travel toward an open submenu never closes it.
export function GroupSubmenu({
	group,
	selected,
	onToggleTool,
	onToggleGroup,
}: {
	group: ToolGroup;
	selected: string[];
	onToggleTool: (name: string, checked: boolean) => void;
	onToggleGroup: (group: ToolGroup, checked: boolean) => void;
}) {
	const checkedCount = group.tools.filter((tool) =>
		selected.includes(tool.name)
	).length;
	return (
		<DropdownMenuSub>
			<DropdownMenuSubTrigger>
				<span className="flex-1 truncate">{group.label}</span>
				<span className="text-muted-foreground text-xs">
					{checkedCount}/{group.tools.length}
				</span>
			</DropdownMenuSubTrigger>
			<DropdownMenuSubContent className="max-h-72 w-[calc(100vw-2rem)] max-w-72 overflow-y-auto">
				<GroupBulkActions group={group} onToggleGroup={onToggleGroup} />
				{group.tools.map((tool) => (
					<DropdownMenuCheckboxItem
						checked={selected.includes(tool.name)}
						closeOnClick={false}
						key={tool.name}
						onCheckedChange={(checked) => onToggleTool(tool.name, checked)}
					>
						<span className="truncate font-mono text-xs">{tool.name}</span>
					</DropdownMenuCheckboxItem>
				))}
			</DropdownMenuSubContent>
		</DropdownMenuSub>
	);
}
