import { Button } from "@better-agent/ui/components/button";
import { cn } from "@better-agent/ui/lib/utils";
import { GitBranchIcon, RefreshCwIcon } from "lucide-react";
import { type GitChannel, useGitChannel } from "./git-channel-store";
import { GitCommitBox } from "./git-commit-box";
import { GitDiffPanel } from "./git-diff-panel";
import type { GitStatusResult } from "./git-events";
import { GitStatusList, groupStatusEntries } from "./git-status-list";
import {
	type GitStatusState,
	useGitDiff,
	useGitStatus,
} from "./use-git-status";
import { WorkspacePathNote } from "./workspace-path-note";

// P4-T4 (docs/local-agent-workspace-plan.md): the workspace Git tab — a
// minimal status/diff/commit panel over the agent's workspace, fed by the
// mounted terminal's git channel (git-channel-store.ts; requestId-correlated
// gitStatus/gitDiff/gitCommit, CLI-side git via execFile). Stage/branch
// operations are phase 2. Mounted as a hidden/flex keep-alive sibling of the
// chat pane, like the Files/Shell panes; on <md the columns stack — status
// list until a diff is opened, then the diff with a back affordance.

/** Centered hint for every "nothing to show" state — mirrors FilesHint. The
 * optional `path` line names the workspace the hint is about. */
function GitHint({
	children,
	path,
}: {
	children: string;
	path?: string | null;
}) {
	return (
		<div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
			<GitBranchIcon aria-hidden className="size-5 opacity-60" />
			<p className="max-w-xs text-xs leading-relaxed">{children}</p>
			<WorkspacePathNote path={path} />
		</div>
	);
}

/** The header's leading label: a muted "非 Git 仓库" once notARepo is known
 * (a forever-"…" branch would read as broken), else the branch name. */
function GitBranchLabel({ state }: { state: GitStatusState }) {
	if (state.kind === "notARepo") {
		return (
			<span className="truncate text-muted-foreground text-sm">
				非 Git 仓库
			</span>
		);
	}
	const branch = state.kind === "ready" ? state.summary.branch : null;
	return (
		<span className="truncate font-medium font-mono text-sm">
			{branch ?? "…"}
		</span>
	);
}

/** Branch name + ahead/behind + whole-tree diff + refresh. */
function GitHeader({
	onRefresh,
	onShowAll,
	state,
}: {
	onRefresh: () => void;
	onShowAll: () => void;
	state: GitStatusState;
}) {
	const summary = state.kind === "ready" ? state.summary : null;
	return (
		<div className="flex shrink-0 items-center gap-2 px-3 py-2 sm:px-4">
			<GitBranchIcon aria-hidden className="size-4 text-muted-foreground" />
			<GitBranchLabel state={state} />
			{summary?.ahead ? (
				<span className="shrink-0 text-muted-foreground text-xs">
					↑{summary.ahead}
				</span>
			) : null}
			{summary?.behind ? (
				<span className="shrink-0 text-muted-foreground text-xs">
					↓{summary.behind}
				</span>
			) : null}
			<Button
				className="ml-auto shrink-0"
				disabled={!summary || summary.entries.length === 0}
				onClick={onShowAll}
				size="sm"
				variant="ghost"
			>
				全部差异
			</Button>
			<Button
				aria-label="Refresh git status"
				disabled={state.kind === "loading"}
				onClick={onRefresh}
				size="icon-sm"
				variant="ghost"
			>
				<RefreshCwIcon className="size-4" />
			</Button>
		</div>
	);
}

/** The ready state's two columns: the grouped status list beside the diff
 * panel (stacked on <md) — split from `GitBody` for the max-lines gate. */
function GitColumns({
	diff,
	summary,
}: {
	diff: ReturnType<typeof useGitDiff>;
	summary: GitStatusResult;
}) {
	const diffOpen = diff.view.kind !== "idle";
	const selectedPath = diff.view.kind === "idle" ? null : diff.view.path;
	return (
		<div className="flex min-h-0 flex-1">
			<div
				className={cn(
					"min-h-0 w-full flex-col overflow-y-auto bg-muted/20 md:flex md:w-72 md:shrink-0",
					diffOpen ? "hidden md:flex" : "flex"
				)}
			>
				<GitStatusList
					groups={groupStatusEntries(summary.entries)}
					onSelect={(path) => diff.open(path)}
					selectedPath={selectedPath}
					truncated={summary.truncated}
				/>
			</div>
			<div
				className={cn(
					"min-h-0 min-w-0 flex-1 flex-col",
					diffOpen ? "flex" : "hidden md:flex"
				)}
			>
				<GitDiffPanel onBack={diff.clear} view={diff.view} />
			</div>
		</div>
	);
}

/** The status/diff two-column body, or the centered hint states. */
function GitBody({
	diff,
	state,
	workspacePath,
}: {
	diff: ReturnType<typeof useGitDiff>;
	state: GitStatusState;
	workspacePath?: string | null;
}) {
	if (state.kind === "idle" || state.kind === "loading") {
		return <GitHint>正在读取 Git 状态…</GitHint>;
	}
	if (state.kind === "error") {
		return <GitHint>{`无法读取 Git 状态：${state.message}`}</GitHint>;
	}
	if (state.kind === "notARepo") {
		return (
			<GitHint path={workspacePath}>
				当前工作区不是 Git 仓库 — 在其中初始化仓库后，这里会显示分支与变更。
			</GitHint>
		);
	}
	if (state.summary.entries.length === 0) {
		return <GitHint>工作区干净，没有未提交的变更。</GitHint>;
	}
	return <GitColumns diff={diff} summary={state.summary} />;
}

function GitPanel({
	channel,
	hidden,
	workspacePath,
}: {
	channel: GitChannel;
	hidden: boolean;
	workspacePath?: string | null;
}) {
	const { refresh, state } = useGitStatus(channel, !hidden);
	const diff = useGitDiff(channel);
	const onCommitted = () => {
		diff.clear();
		refresh();
	};
	return (
		<>
			<GitHeader
				onRefresh={refresh}
				onShowAll={() => diff.open(null)}
				state={state}
			/>
			<GitBody diff={diff} state={state} workspacePath={workspacePath} />
			{/* No repo → no commit affordance: a disabled-forever commit box would
			 * read as "broken", not "not applicable". */}
			{state.kind !== "notARepo" && (
				<GitCommitBox
					channel={channel}
					disabled={
						state.kind !== "ready" || state.summary.entries.length === 0
					}
					onCommitted={onCommitted}
				/>
			)}
		</>
	);
}

/** The Git tab pane — a keep-alive hidden/flex sibling of the chat pane. */
export function LocalAgentGitPane({
	hidden,
	workspacePath,
}: {
	hidden: boolean;
	workspacePath?: string | null;
}) {
	const channel = useGitChannel();
	return (
		<div className={hidden ? "hidden" : "flex min-h-0 flex-1 flex-col"}>
			{channel?.enabled ? (
				<GitPanel
					channel={channel}
					hidden={hidden}
					workspacePath={workspacePath}
				/>
			) : (
				<GitHint>
					{channel
						? "当前 CLI 版本过旧，暂不支持 Git 面板。请升级 agent CLI 后重试。"
						: "连接会话后即可查看 Git 状态。"}
				</GitHint>
			)}
		</div>
	);
}
