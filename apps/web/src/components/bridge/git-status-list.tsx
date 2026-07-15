import { cn } from "@better-agent/ui/lib/utils";
import type { GitStatusEntry } from "./git-events";

// P4-T4: the Git pane's grouped status list — 已暂存 / 未暂存 / 未跟踪, one
// clickable row per file (click → that path's diff). A file changed on both
// sides (x=M y=M) appears in both groups, porcelain-style. Borderless: tinted
// hover/selected states only.

export interface GitGroups {
	staged: GitStatusEntry[];
	unstaged: GitStatusEntry[];
	untracked: GitStatusEntry[];
}

/** Splits porcelain entries into the three display groups. `x` is the staged
 * (index) char, `y` the worktree one; `?` marks untracked. */
export function groupStatusEntries(entries: GitStatusEntry[]): GitGroups {
	const groups: GitGroups = { staged: [], unstaged: [], untracked: [] };
	for (const entry of entries) {
		if (entry.x === "?") {
			groups.untracked.push(entry);
			continue;
		}
		if (entry.x !== " ") {
			groups.staged.push(entry);
		}
		if (entry.y !== " ") {
			groups.unstaged.push(entry);
		}
	}
	return groups;
}

function StatusRow({
	badge,
	entry,
	onSelect,
	selected,
}: {
	badge: string;
	entry: GitStatusEntry;
	onSelect: (path: string) => void;
	selected: boolean;
}) {
	return (
		<button
			className={cn(
				"flex w-full items-center gap-2 rounded-md px-2 py-1 text-left font-mono text-xs transition-colors hover:bg-muted/60",
				selected && "bg-muted/80"
			)}
			onClick={() => onSelect(entry.path)}
			type="button"
		>
			<span
				className={cn(
					"w-4 shrink-0 text-center font-semibold",
					badge === "?" ? "text-muted-foreground" : "text-amber-500"
				)}
			>
				{badge}
			</span>
			<span className="min-w-0 flex-1 truncate text-foreground/90">
				{entry.origPath ? `${entry.origPath} → ${entry.path}` : entry.path}
			</span>
		</button>
	);
}

function StatusGroup({
	badgeOf,
	entries,
	label,
	onSelect,
	selectedPath,
}: {
	badgeOf: (entry: GitStatusEntry) => string;
	entries: GitStatusEntry[];
	label: string;
	onSelect: (path: string) => void;
	selectedPath: string | null;
}) {
	if (entries.length === 0) {
		return null;
	}
	return (
		<div className="flex flex-col gap-0.5">
			<div className="px-2 pt-2 pb-1 font-medium text-muted-foreground text-xs">
				{label}（{entries.length}）
			</div>
			{entries.map((entry) => (
				<StatusRow
					badge={badgeOf(entry)}
					entry={entry}
					key={`${label}-${entry.path}`}
					onSelect={onSelect}
					selected={selectedPath === entry.path}
				/>
			))}
		</div>
	);
}

/** The three grouped sections. The clean-tree/empty state is the pane's job —
 * this renders whatever groups it's given. */
export function GitStatusList({
	groups,
	onSelect,
	selectedPath,
	truncated,
}: {
	groups: GitGroups;
	onSelect: (path: string) => void;
	selectedPath: string | null;
	truncated: boolean;
}) {
	return (
		<div className="flex flex-col gap-1 p-2">
			<StatusGroup
				badgeOf={(entry) => entry.x}
				entries={groups.staged}
				label="已暂存"
				onSelect={onSelect}
				selectedPath={selectedPath}
			/>
			<StatusGroup
				badgeOf={(entry) => entry.y}
				entries={groups.unstaged}
				label="未暂存"
				onSelect={onSelect}
				selectedPath={selectedPath}
			/>
			<StatusGroup
				badgeOf={() => "?"}
				entries={groups.untracked}
				label="未跟踪"
				onSelect={onSelect}
				selectedPath={selectedPath}
			/>
			{truncated ? (
				<p className="px-2 py-1 text-muted-foreground text-xs italic">
					变更过多，仅显示部分文件。
				</p>
			) : null}
		</div>
	);
}
