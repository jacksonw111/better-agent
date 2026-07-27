import { Button } from "@better-agent/ui/components/button";
import { Input } from "@better-agent/ui/components/input";
import { useMutation } from "@tanstack/react-query";
import { CornerDownLeftIcon } from "lucide-react";
import { useState } from "react";
import { WorkspacePaneShell } from "./workspace-pane-shell";
import {
	runWorkspaceShell,
	type WorkspaceShellOutcome,
} from "./workspace-query";

// DP-WS: the terminal page's Shell pane — a scratch shell that runs one command
// at a time IN the session's workspace cwd, independent of the agent's own
// terminal above. That independence is the whole point: you can inspect the
// workspace (ls, git log, cat) without disturbing the running agent. Output is
// bounded server/CLI-side (per-stream cap + timeout); a truncated run says so.

interface ShellEntry {
	cmd: string;
	error?: string;
	id: number;
	result?: WorkspaceShellOutcome;
}

function ExitLine({ result }: { result: WorkspaceShellOutcome }) {
	const codeLabel =
		result.exitCode === null ? "killed" : `exit ${result.exitCode}`;
	const tone =
		result.exitCode === 0
			? "text-emerald-600 dark:text-emerald-400"
			: "text-red-600 dark:text-red-400";
	return (
		<span className={`text-[10px] ${tone}`}>
			{codeLabel}
			{result.truncated ? " · output truncated" : ""}
		</span>
	);
}

function ShellEntryView({ entry }: { entry: ShellEntry }) {
	return (
		<div className="flex flex-col gap-1">
			<div className="flex items-center gap-2">
				<span aria-hidden className="text-muted-foreground text-xs">
					$
				</span>
				<span className="min-w-0 flex-1 truncate font-mono text-xs">
					{entry.cmd}
				</span>
				{entry.result && <ExitLine result={entry.result} />}
			</div>
			{entry.error && (
				<pre className="whitespace-pre-wrap break-all rounded-md bg-red-500/10 p-2 font-mono text-red-600 text-xs dark:text-red-400">
					{entry.error}
				</pre>
			)}
			{entry.result &&
				(entry.result.stdout || entry.result.stderr ? (
					<pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-neutral-950 p-2 font-mono text-neutral-100 text-xs">
						{entry.result.stdout}
						{entry.result.stderr && (
							<span className="text-red-400">{entry.result.stderr}</span>
						)}
					</pre>
				) : (
					<p className="text-muted-foreground text-xs">No output.</p>
				))}
		</div>
	);
}

function ShellForm({
	onSubmit,
	pending,
}: {
	onSubmit: (command: string) => void;
	pending: boolean;
}) {
	const [cmd, setCmd] = useState("");
	const submit = () => {
		const command = cmd.trim();
		if (!command || pending) {
			return;
		}
		onSubmit(command);
		setCmd("");
	};
	return (
		<form
			className="flex items-center gap-2"
			onSubmit={(event) => {
				event.preventDefault();
				submit();
			}}
		>
			<Input
				aria-label="Shell command"
				className="font-mono text-sm"
				disabled={pending}
				onChange={(event) => setCmd(event.target.value)}
				placeholder="Run a command in the workspace…"
				value={cmd}
			/>
			<Button
				aria-label="Run command"
				disabled={pending || cmd.trim() === ""}
				size="icon-sm"
				type="submit"
				variant="outline"
			>
				<CornerDownLeftIcon className="size-4" />
			</Button>
		</form>
	);
}

function ShellLog({ entries }: { entries: ShellEntry[] }) {
	if (entries.length === 0) {
		return (
			<p className="text-muted-foreground text-xs">
				Runs in the session's working directory, independent of the agent
				terminal above.
			</p>
		);
	}
	return (
		<div className="flex flex-col gap-3">
			{entries.map((entry) => (
				<ShellEntryView entry={entry} key={entry.id} />
			))}
		</div>
	);
}

export function WorkspaceShellPane({ sessionId }: { sessionId: string }) {
	const [entries, setEntries] = useState<ShellEntry[]>([]);
	const run = useMutation({
		mutationFn: (command: string) => runWorkspaceShell(sessionId, command),
		onError: (error: Error, command) => {
			setEntries((prev) => [
				{ cmd: command, error: error.message, id: Date.now() },
				...prev,
			]);
		},
		onSuccess: (result, command) => {
			setEntries((prev) => [{ cmd: command, id: Date.now(), result }, ...prev]);
		},
	});
	return (
		<WorkspacePaneShell sessionId={sessionId} title="Shell">
			<div className="flex flex-col gap-3">
				<ShellForm
					onSubmit={(command) => run.mutate(command)}
					pending={run.isPending}
				/>
				<ShellLog entries={entries} />
			</div>
		</WorkspacePaneShell>
	);
}
