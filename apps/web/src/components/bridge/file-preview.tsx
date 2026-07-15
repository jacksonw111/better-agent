import { Button } from "@better-agent/ui/components/button";
import {
	CheckIcon,
	ChevronLeftIcon,
	CopyIcon,
	FileTextIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

// P4-T3: the Files tab's right-hand preview — mono text with horizontal
// scroll, a copy affordance, and dedicated binary / too-large / error states.
// Borderless language: tinted header strip, no borders or rings. `onBack`
// renders only on <md, where the pane stacks tree ⇄ preview.

export type FilePreviewState =
	| { kind: "idle" }
	| { kind: "loading"; path: string }
	| { kind: "error"; message: string; path: string }
	| {
			binary: boolean;
			content: string;
			kind: "ready";
			path: string;
			truncated: boolean;
	  };

const COPY_RESET_MS = 1500;
const COPY_FAILURE_MESSAGE = "复制失败，请重试。";

/** Copy-to-clipboard with a transient ✓ — the timer is cleared on unmount. */
function CopyButton({ content }: { content: string }) {
	const [copied, setCopied] = useState(false);
	const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	useEffect(
		() => () => {
			if (timerRef.current !== undefined) {
				clearTimeout(timerRef.current);
			}
		},
		[]
	);
	const copy = () => {
		navigator.clipboard.writeText(content).then(
			() => {
				setCopied(true);
				timerRef.current = setTimeout(() => setCopied(false), COPY_RESET_MS);
			},
			() => toast.error(COPY_FAILURE_MESSAGE)
		);
	};
	return (
		<Button
			aria-label="Copy file contents"
			onClick={copy}
			size="icon-sm"
			type="button"
			variant="ghost"
		>
			{copied ? (
				<CheckIcon className="size-4 text-emerald-500" />
			) : (
				<CopyIcon className="size-4" />
			)}
		</Button>
	);
}

/** Centered hint for every "no content" state (idle/loading/binary/error). */
function PreviewHint({ children }: { children: string }) {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
			<FileTextIcon aria-hidden className="size-5 opacity-60" />
			<p className="max-w-xs text-xs leading-relaxed">{children}</p>
		</div>
	);
}

function PreviewBody({ state }: { state: FilePreviewState }) {
	if (state.kind === "idle") {
		return <PreviewHint>选择左侧文件以预览内容。</PreviewHint>;
	}
	if (state.kind === "loading") {
		return <PreviewHint>读取中…</PreviewHint>;
	}
	if (state.kind === "error") {
		return <PreviewHint>{`无法读取文件：${state.message}`}</PreviewHint>;
	}
	if (state.binary) {
		return <PreviewHint>二进制文件，无法预览。</PreviewHint>;
	}
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<pre className="min-h-0 flex-1 overflow-auto whitespace-pre p-3 font-mono text-foreground text-xs leading-relaxed sm:p-4">
				{state.content}
			</pre>
			{state.truncated && (
				<p className="shrink-0 bg-amber-500/10 px-3 py-1.5 text-amber-600 text-xs dark:text-amber-400">
					文件超过 256KB，仅显示开头部分。
				</p>
			)}
		</div>
	);
}

/** The preview panel: sticky path header (with mobile back + copy) above the
 * scrolling body. */
export function FilePreview({
	onBack,
	state,
}: {
	onBack: () => void;
	state: FilePreviewState;
}) {
	const path = state.kind === "idle" ? null : state.path;
	const copyContent =
		state.kind === "ready" && !state.binary ? state.content : null;
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{path !== null && (
				<div className="flex shrink-0 items-center gap-1 bg-muted/30 px-2 py-1.5">
					<Button
						aria-label="Back to file tree"
						className="md:hidden"
						onClick={onBack}
						size="icon-sm"
						type="button"
						variant="ghost"
					>
						<ChevronLeftIcon className="size-4" />
					</Button>
					<span className="min-w-0 flex-1 truncate font-mono text-muted-foreground text-xs">
						{path}
					</span>
					{copyContent !== null && <CopyButton content={copyContent} />}
				</div>
			)}
			<PreviewBody state={state} />
		</div>
	);
}
