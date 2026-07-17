import { Button } from "@better-agent/ui/components/button";
import { ArrowLeftIcon } from "lucide-react";
import { GitDiffView } from "./git-diff-view";
import type { GitDiffState } from "./use-git-status";

// P4-T4: the Git tab's right column — the opened diff's header (path, <md
// back affordance, truncation note) over its loading/error/empty/ready body.
// Extracted from local-agent-git-pane.tsx for the 300-line file cap.

/** The right column: the opened diff (path header + tinted body), or the
 * md+ placeholder while nothing is selected. */
export function GitDiffPanel({
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
