import { Button } from "@better-agent/ui/components/button";
import { cn } from "@better-agent/ui/lib/utils";
import { ArrowLeftIcon, GitBranchIcon, RefreshCwIcon } from "lucide-react";
import { type GitChannel, useGitChannel } from "./git-channel-store";
import { GitCommitBox } from "./git-commit-box";
import { GitDiffView } from "./git-diff-view";
import { GitStatusList, groupStatusEntries } from "./git-status-list";
import {
	type GitDiffState,
	type GitStatusState,
	useGitDiff,
	useGitStatus,
} from "./use-git-status";

// P4-T4 (docs/local-agent-workspace-plan.md): the workspace Git tab — a
// minimal status/diff/commit panel over the agent's workspace, fed by the
// mounted terminal's git channel (git-channel-store.ts; requestId-correlated
// gitStatus/gitDiff/gitCommit, CLI-side git via execFile). Stage/branch
// operations are phase 2. Mounted as a hidden/flex keep-alive sibling of the
// chat pane, like the Files/Shell panes; on <md the columns stack — status
// list until a diff is opened, then the diff with a back affordance.

/** Centered hint for every "nothing to show" state — mirrors FilesHint. */
function GitHint({ children }: { children: string }) {
	return (
		<div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
			<GitBranchIcon aria-hidden className="size-5 opacity-60" />
			<p className="max-w-xs text-xs leading-relaxed">{children}</p>
		</div>
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
			<span className="truncate font-medium font-mono text-sm">
				{summary?.branch ?? "…"}
			</span>
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

/** The right column: the opened diff (path header + tinted body), or the
 * md+ placeholder while nothing is selected. */
function GitDiffPanel({
	onBack,
	view,
}: {
	onBack: () => void;
	view: GitDiffState;
}) {
	if (view.kind === "idle") {
		return (
			<div className="hidden flex-1 items-center justify-center p-6 text-muted-foreground text-xs md:flex">
				点击左侧文件查看差异
			</div>
		);
	}
	return (
		<div className="flex min-h-0 flex-1 flex-col px-3 pb-2 sm:px-4">
			<div className="flex shrink-0 items-center gap-1 py-1">
				<Button
					aria-label="Back to changed files"
					className="md:hidden"
					onClick={onBack}
					size="icon-sm"
					variant="ghost"
				>
					<ArrowLeftIcon className="size-4" />
				</Button>
				<span className="truncate font-mono text-muted-foreground text-xs">
					{view.path ?? "全部差异"}
				</span>
				{view.kind === "ready" && view.truncated ? (
					<span className="shrink-0 text-muted-foreground text-xs italic">
						（超过 512KB，已截断）
					</span>
				) : null}
			</div>
			<GitDiffBody view={view} />
		</div>
	);
}

/** The diff panel's loading/error/empty/ready body — split from
 * `GitDiffPanel` for the max-lines-per-function and complexity gates. */
function GitDiffBody({ view }: { view: GitDiffState }) {
	if (view.kind === "loading") {
		return <p className="p-4 text-muted-foreground text-xs">正在加载差异…</p>;
	}
	if (view.kind === "error") {
		return (
			<p className="p-4 text-destructive text-xs">
				无法加载差异：{view.message}
			</p>
		);
	}
	if (view.kind !== "ready") {
		return null;
	}
	if (view.text === "") {
		return (
			<p className="p-4 text-muted-foreground text-xs">
				没有差异内容（新文件或无变化）。
			</p>
		);
	}
	return <GitDiffView text={view.text} />;
}

/** The status/diff two-column body, or the centered hint states. */
function GitBody({
	diff,
	state,
}: {
	diff: ReturnType<typeof useGitDiff>;
	state: GitStatusState;
}) {
	if (state.kind === "idle" || state.kind === "loading") {
		return <GitHint>正在读取 Git 状态…</GitHint>;
	}
	if (state.kind === "error") {
		return <GitHint>{`无法读取 Git 状态：${state.message}`}</GitHint>;
	}
	if (state.kind === "notARepo") {
		return <GitHint>当前工作区不是 Git 仓库。</GitHint>;
	}
	const { summary } = state;
	if (summary.entries.length === 0) {
		return <GitHint>工作区干净，没有未提交的变更。</GitHint>;
	}
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

function GitPanel({
	channel,
	hidden,
}: {
	channel: GitChannel;
	hidden: boolean;
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
			<GitBody diff={diff} state={state} />
			<GitCommitBox
				channel={channel}
				disabled={state.kind !== "ready" || state.summary.entries.length === 0}
				onCommitted={onCommitted}
			/>
		</>
	);
}

/** The Git tab pane — a keep-alive hidden/flex sibling of the chat pane. */
export function LocalAgentGitPane({ hidden }: { hidden: boolean }) {
	const channel = useGitChannel();
	return (
		<div className={hidden ? "hidden" : "flex min-h-0 flex-1 flex-col"}>
			{channel?.enabled ? (
				<GitPanel channel={channel} hidden={hidden} />
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
