import { Collapsible } from "@base-ui/react/collapsible";
import { ToolStatusIcon } from "@better-agent/ui/components/chat/tool-status-icon";
import { Response } from "@better-agent/ui/components/response";
import { cn } from "@better-agent/ui/lib/utils";
import { BotIcon, CheckIcon, ChevronDownIcon, Loader2Icon } from "lucide-react";
import { useState } from "react";
import { formatDurationMs } from "./activity-format";
import { useAutoOpenOnError } from "./bash-command-card";
import type { TaskInvocation, TaskToolRun } from "./task-invocation";

const TASK_STATUS_LABEL: Record<TaskInvocation["status"], string> = {
	complete: "Done",
	error: "Failed",
	running: "Running…",
};

/** The left accent spine — a tint bar in the activity-dot palette
 * (activity-spine-dot.tsx), NOT a border: running=blue (pulsing),
 * ok=primary tint, error=destructive. */
const ACCENT_BAR_CLASS: Record<TaskInvocation["status"], string> = {
	complete: "bg-primary/40",
	error: "bg-destructive/60",
	running: "animate-pulse bg-blue-500/60",
};

const RESULT_CLAMP_LINES = 6;
const RESULT_CLAMP_CHARS = 480;

function isClampable(text: string): boolean {
	return (
		text.split("\n").length > RESULT_CLAMP_LINES ||
		text.length > RESULT_CLAMP_CHARS
	);
}

function SectionLabel({ children }: { children: string }) {
	return (
		<span className="font-medium text-muted-foreground/80 text-xs uppercase tracking-wide">
			{children}
		</span>
	);
}

function CompletedCount({ runs }: { runs: TaskToolRun[] }) {
	const done = runs.filter((run) => run.status === "complete").length;
	if (done === 0) {
		return null;
	}
	return (
		<span className="flex items-center gap-0.5 tabular-nums">
			<CheckIcon aria-hidden className="size-3" />
			{done}
		</span>
	);
}

function TaskDuration({ durationMs }: { durationMs?: number }) {
	if (durationMs === undefined) {
		return null;
	}
	return <span className="tabular-nums">{formatDurationMs(durationMs)}</span>;
}

/** Folded header: bot chip, "Subagent · {description}", then the live meta
 * cluster (✓ done-count, duration, status, disclosure chevron). */
function TaskHeader({ open, task }: { open: boolean; task: TaskInvocation }) {
	const isError = task.status === "error";
	return (
		<Collapsible.Trigger className="flex w-full items-center gap-2 text-left">
			<span
				className={cn(
					"flex size-6 shrink-0 items-center justify-center rounded-md",
					isError
						? "bg-destructive/10 text-destructive"
						: "bg-primary/10 text-primary"
				)}
			>
				<BotIcon className="size-3.5" />
			</span>
			<span className="min-w-0 flex-1 truncate text-sm">
				<span className="text-muted-foreground">Subagent · </span>
				<span className="font-medium">{task.title}</span>
			</span>
			<span className="flex shrink-0 items-center gap-2 text-muted-foreground text-xs">
				<CompletedCount runs={task.toolRuns ?? []} />
				<TaskDuration durationMs={task.durationMs} />
				<span className="flex items-center gap-1">
					<ToolStatusIcon status={task.status} />
					{TASK_STATUS_LABEL[task.status]}
				</span>
				<ChevronDownIcon
					className={cn(
						"size-3.5 shrink-0 transition-transform",
						open && "rotate-180"
					)}
				/>
			</span>
		</Collapsible.Trigger>
	);
}

/** The live "Currently: {tool}" indicator, only while the subagent runs —
 * the most recent still-running tool wins, falling back to the last one
 * seen, then to a plain shimmer while nothing has been attributed yet. */
function CurrentlyLine({ task }: { task: TaskInvocation }) {
	if (task.status !== "running") {
		return null;
	}
	const runs = task.toolRuns ?? [];
	const lastRunning = [...runs]
		.reverse()
		.find((run) => run.status === "running");
	const current = lastRunning ?? runs.at(-1);
	return (
		<div className="mt-1.5 flex items-center gap-1.5 pl-8 text-muted-foreground text-xs">
			<Loader2Icon aria-hidden className="size-3 shrink-0 animate-spin" />
			{current ? (
				<span className="truncate">
					Currently:{" "}
					<span className="font-mono text-foreground">{current.name}</span>
				</span>
			) : (
				<span className="shimmer font-medium">Working…</span>
			)}
		</div>
	);
}

function PromptSection({
	prompt,
	subagentType,
}: {
	prompt?: string;
	subagentType?: string;
}) {
	if (!prompt) {
		return null;
	}
	return (
		<div className="flex flex-col gap-1">
			<SectionLabel>
				{subagentType ? `Prompt · ${subagentType}` : "Prompt"}
			</SectionLabel>
			<p className="line-clamp-3 whitespace-pre-wrap text-muted-foreground text-xs leading-relaxed">
				{prompt}
			</p>
		</div>
	);
}

function ToolHistory({ runs }: { runs: TaskToolRun[] }) {
	if (runs.length === 0) {
		return null;
	}
	return (
		<div className="flex flex-col gap-1">
			<SectionLabel>Tools</SectionLabel>
			<ul className="flex flex-col gap-0.5">
				{runs.map((run) => (
					<li className="flex items-center gap-1.5 text-xs" key={run.callId}>
						<ToolStatusIcon status={run.status} />
						<span
							className={cn(
								"truncate font-mono",
								run.status === "error"
									? "text-destructive"
									: "text-muted-foreground"
							)}
						>
							{run.name}
						</span>
					</li>
				))}
			</ul>
		</div>
	);
}

/** The subagent's final summary, rendered as markdown and clamped to six
 * lines with a "Show full result" toggle when it's long. */
function TaskResult({
	status,
	text,
}: {
	status: TaskInvocation["status"];
	text: string;
}) {
	const [expanded, setExpanded] = useState(false);
	if (!text) {
		return (
			<p className="text-muted-foreground text-xs">
				{status === "running" ? "No result yet." : "No result."}
			</p>
		);
	}
	const clampable = isClampable(text);
	return (
		<div className="flex flex-col items-start gap-1">
			<SectionLabel>Result</SectionLabel>
			<div
				className={cn(
					"w-full rounded-md bg-background/60 px-2.5 py-2",
					clampable && !expanded && "line-clamp-6"
				)}
			>
				<Response className="text-xs">{text}</Response>
			</div>
			{clampable && (
				<button
					className="text-muted-foreground text-xs underline-offset-2 transition-colors hover:text-foreground hover:underline"
					onClick={() => setExpanded((v) => !v)}
					type="button"
				>
					{expanded ? "Show less" : "Show full result"}
				</button>
			)}
		</div>
	);
}

/** P1-T3: the card for a subagent "Task" call. Folded: accent spine bar +
 * "Subagent · {description}" + live status (+ "Currently: {tool}" and a ✓
 * done-count while running). Expanded: clamped prompt, attributed tool
 * history (errors red), and the result as clamped markdown. A late failure
 * auto-expands exactly once — same contract as `BashCommandCard`. */
export function TaskCard({ task }: { task: TaskInvocation }) {
	const { open, setOpenManually } = useAutoOpenOnError(task.status === "error");
	return (
		<div
			className={cn(
				"relative rounded-xl bg-muted/40 p-3 pl-5",
				task.status === "error" && "bg-destructive/10"
			)}
		>
			<span
				aria-hidden
				className={cn(
					"absolute inset-y-3 left-2 w-0.5 rounded-full",
					ACCENT_BAR_CLASS[task.status]
				)}
			/>
			<Collapsible.Root onOpenChange={setOpenManually} open={open}>
				<TaskHeader open={open} task={task} />
				<CurrentlyLine task={task} />
				<Collapsible.Panel className="mt-2.5 flex flex-col gap-2.5">
					<PromptSection
						prompt={task.prompt}
						subagentType={task.subagentType}
					/>
					<ToolHistory runs={task.toolRuns ?? []} />
					<TaskResult status={task.status} text={task.resultText} />
				</Collapsible.Panel>
			</Collapsible.Root>
		</div>
	);
}
