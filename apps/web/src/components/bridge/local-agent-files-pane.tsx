import { Button } from "@better-agent/ui/components/button";
import { cn } from "@better-agent/ui/lib/utils";
import { FolderTreeIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import { FilePreview, type FilePreviewState } from "./file-preview";
import { FileTree } from "./file-tree";
import { type FsChannel, useFsChannel } from "./fs-channel-store";
import { useFileTree } from "./use-file-tree";
import { WorkspacePathNote } from "./workspace-path-note";

// P4-T3 (docs/local-agent-workspace-plan.md): the workspace Files tab — a
// READ-ONLY tree + preview over the agent's workspace, fed by the mounted
// terminal's fs channel (fs-channel-store.ts; requestId-correlated
// fsList/fsRead, path-confined CLI-side). Mounted as a hidden/flex keep-alive
// sibling of the chat pane, like the Shell pane. On <md the columns stack:
// tree until a file is selected, then the preview with a back affordance.

/** Centered hint for the "no channel / old CLI" states — mirrors ShellHint. */
function FilesHint({ children }: { children: string }) {
	return (
		<div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
			<FolderTreeIcon aria-hidden className="size-5 opacity-60" />
			<p className="max-w-xs text-xs leading-relaxed">{children}</p>
		</div>
	);
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : "请重试";
}

/** The whole-pane state for a workspace whose ROOT listing came back empty —
 * an empty workspace is a normal starting point (e.g. a fresh managed task
 * directory), so it gets an explanation + the path + a refresh, not a bare
 * tree. Subdirectory-level emptiness keeps the inline tree note. */
function FilesEmptyWorkspace({
	onRefresh,
	workspacePath,
}: {
	onRefresh: () => void;
	workspacePath?: string | null;
}) {
	return (
		<div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
			<FolderTreeIcon aria-hidden className="size-5 opacity-60" />
			<p className="max-w-xs text-xs leading-relaxed">
				工作区目前是空的 — agent 创建的文件会出现在这里。
			</p>
			<WorkspacePathNote path={workspacePath} />
			<Button onClick={onRefresh} size="sm" type="button" variant="ghost">
				<RefreshCwIcon aria-hidden className="size-3.5" />
				刷新
			</Button>
		</div>
	);
}

/** Preview state + the stale-response-safe file opener. */
function usePreview(channel: FsChannel | null) {
	const [preview, setPreview] = useState<FilePreviewState>({ kind: "idle" });
	const apply = (path: string, next: FilePreviewState) =>
		// Only the LATEST clicked file may settle the preview — a slower earlier
		// read resolving after a newer click must not overwrite it.
		setPreview((prev) =>
			prev.kind === "loading" && prev.path === path ? next : prev
		);
	const openFile = (path: string) => {
		setPreview({ kind: "loading", path });
		channel?.read(path).then(
			(result) =>
				apply(path, {
					binary: result.binary,
					content: result.content,
					kind: "ready",
					path,
					truncated: result.truncated,
				}),
			(error: unknown) =>
				apply(path, { kind: "error", message: errorText(error), path })
		);
	};
	return { clear: () => setPreview({ kind: "idle" }), openFile, preview };
}

function FilesColumns({
	channel,
	hidden,
	workspacePath,
}: {
	channel: FsChannel;
	hidden: boolean;
	workspacePath?: string | null;
}) {
	const tree = useFileTree(channel, !hidden);
	const { clear, openFile, preview } = usePreview(channel);
	const selectedPath = preview.kind === "idle" ? null : preview.path;
	const root = tree.dirs[""];
	if (root?.status === "ready" && root.entries.length === 0) {
		return (
			<FilesEmptyWorkspace
				onRefresh={tree.refreshRoot}
				workspacePath={workspacePath}
			/>
		);
	}
	return (
		<>
			<div
				className={cn(
					"min-h-0 w-full flex-col overflow-y-auto bg-muted/20 md:flex md:w-64 md:shrink-0",
					selectedPath === null ? "flex" : "hidden md:flex"
				)}
			>
				<FileTree
					ctx={{
						dirs: tree.dirs,
						expanded: tree.expanded,
						onSelectFile: openFile,
						onToggleDir: tree.toggleDir,
						selectedPath,
					}}
				/>
			</div>
			<div
				className={cn(
					"min-h-0 min-w-0 flex-1 flex-col",
					selectedPath === null ? "hidden md:flex" : "flex"
				)}
			>
				<FilePreview onBack={clear} state={preview} />
			</div>
		</>
	);
}

/** The Files tab pane — a keep-alive hidden/flex sibling of the chat pane. */
export function LocalAgentFilesPane({
	hidden,
	workspacePath,
}: {
	hidden: boolean;
	workspacePath?: string | null;
}) {
	const channel = useFsChannel();
	return (
		<div className={hidden ? "hidden" : "flex min-h-0 flex-1"}>
			{channel?.enabled ? (
				<FilesColumns
					channel={channel}
					hidden={hidden}
					workspacePath={workspacePath}
				/>
			) : (
				<FilesHint>
					{channel
						? "当前 CLI 版本过旧，暂不支持文件浏览。请升级 agent CLI 后重试。"
						: "连接会话后即可浏览工作区文件。"}
				</FilesHint>
			)}
		</div>
	);
}
