import { cn } from "@better-agent/ui/lib/utils";
import {
	ChevronDownIcon,
	ChevronRightIcon,
	FileIcon,
	FolderIcon,
} from "lucide-react";
import type { FsEntry } from "./fs-events";
import type { DirState } from "./use-file-tree";

// P4-T3: the Files tab's read-only tree — purely presentational over the
// lazily-loaded `useFileTree` state (dirs-first entries per level, chevron +
// folder/file icons, muted right-aligned sizes). Borderless language: tinted
// hover/selection, no borders or rings. Nesting indents via each level's own
// padding, no inline styles.

export interface FileTreeContext {
	dirs: Record<string, DirState>;
	expanded: ReadonlySet<string>;
	onSelectFile: (path: string) => void;
	onToggleDir: (path: string) => void;
	selectedPath: string | null;
}

const KB = 1024;
const SIZE_DECIMALS_LIMIT = 10;

/** Compact human size for the muted right column — "812 B", "4.2 KB", "1.3 MB". */
export function formatFileSize(size: number | undefined): string {
	if (size === undefined) {
		return "";
	}
	if (size < KB) {
		return `${size} B`;
	}
	const kb = size / KB;
	if (kb < KB) {
		return `${kb < SIZE_DECIMALS_LIMIT ? kb.toFixed(1) : Math.round(kb)} KB`;
	}
	const mb = kb / KB;
	return `${mb < SIZE_DECIMALS_LIMIT ? mb.toFixed(1) : Math.round(mb)} MB`;
}

function childPath(parentPath: string, name: string): string {
	return parentPath === "" ? name : `${parentPath}/${name}`;
}

function LevelNote({ children }: { children: string }) {
	return <p className="px-2 py-1 text-muted-foreground text-xs">{children}</p>;
}

function DirNode({ ctx, path, entry }: TreeNodeProps) {
	const open = ctx.expanded.has(path);
	const Chevron = open ? ChevronDownIcon : ChevronRightIcon;
	return (
		<li>
			<button
				aria-expanded={open}
				className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs hover:bg-accent/60"
				onClick={() => ctx.onToggleDir(path)}
				type="button"
			>
				<Chevron
					aria-hidden
					className="size-3.5 shrink-0 text-muted-foreground"
				/>
				<FolderIcon
					aria-hidden
					className="size-3.5 shrink-0 text-muted-foreground"
				/>
				<span className="truncate">{entry.name}</span>
			</button>
			{open && <TreeLevel ctx={ctx} dirPath={path} />}
		</li>
	);
}

function FileNode({ ctx, path, entry }: TreeNodeProps) {
	const selected = ctx.selectedPath === path;
	return (
		<li>
			<button
				aria-current={selected}
				className={cn(
					"flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs",
					selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"
				)}
				onClick={() => ctx.onSelectFile(path)}
				type="button"
			>
				<span aria-hidden className="size-3.5 shrink-0" />
				<FileIcon
					aria-hidden
					className="size-3.5 shrink-0 text-muted-foreground"
				/>
				<span className="min-w-0 flex-1 truncate">{entry.name}</span>
				<span className="shrink-0 text-muted-foreground text-xs">
					{formatFileSize(entry.size)}
				</span>
			</button>
		</li>
	);
}

interface TreeNodeProps {
	ctx: FileTreeContext;
	entry: FsEntry;
	path: string;
}

/** One directory's children — loading/error/empty notes, else the entry rows
 * (recursing into expanded subdirectories). Nested levels indent themselves. */
export function TreeLevel({
	ctx,
	dirPath,
}: {
	ctx: FileTreeContext;
	dirPath: string;
}) {
	const state = ctx.dirs[dirPath];
	const nested = dirPath === "" ? "" : "pl-3";
	if (!state || state.status === "loading") {
		return (
			<div className={nested}>
				<LevelNote>加载中…</LevelNote>
			</div>
		);
	}
	if (state.status === "error") {
		return (
			<div className={nested}>
				<LevelNote>无法读取目录</LevelNote>
			</div>
		);
	}
	return (
		<ul className={nested}>
			{state.entries.map((entry) => {
				const path = childPath(dirPath, entry.name);
				return entry.type === "dir" ? (
					<DirNode ctx={ctx} entry={entry} key={path} path={path} />
				) : (
					<FileNode ctx={ctx} entry={entry} key={path} path={path} />
				);
			})}
			{state.entries.length === 0 && (
				<li>
					<LevelNote>空目录</LevelNote>
				</li>
			)}
			{state.truncated && (
				<li>
					<LevelNote>目录过大，仅显示前 500 项</LevelNote>
				</li>
			)}
		</ul>
	);
}

/** The whole tree, rooted at the workspace dir. */
export function FileTree({ ctx }: { ctx: FileTreeContext }) {
	return (
		<nav aria-label="Workspace files" className="p-2">
			<TreeLevel ctx={ctx} dirPath="" />
		</nav>
	);
}
