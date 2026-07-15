import { Button } from "@better-agent/ui/components/button";
import { CornerDownLeftIcon, TerminalIcon } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { BashCommandCard } from "./bash-command-card";
import { type ShellChannel, useShellChannel } from "./shell-channel-store";
import { foldShellEvents } from "./shell-events";

// P4-T2 (docs/local-agent-workspace-plan.md): the workspace Shell tab's pane —
// a one-shot command runner over the agent's workspace. It reads the mounted
// terminal's shell channel (shell-channel-store.ts): a `$`-prefixed input row
// runs `runShell`, and the feed's out-of-band results render via the SAME
// `BashCommandCard` the chat feed uses. Interactive pty is phase 2 — this is
// deliberately fire-and-forget single commands only.

const RUN_FAILURE_MESSAGE = "Couldn't run that command — try again.";

/** Centered hint shown in place of the command history — used for every
 * "nothing to show yet" state (no session, old CLI, no commands run). */
function ShellHint({ children }: { children: string }) {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
			<TerminalIcon aria-hidden className="size-5 opacity-60" />
			<p className="max-w-xs text-xs leading-relaxed">{children}</p>
		</div>
	);
}

/** The scrollable command history, auto-scrolled to the newest card. Falls
 * back to a hint while empty (or the CLI can't answer runShell). */
function ShellHistory({ channel }: { channel: ShellChannel | null }) {
	const bottomRef = useRef<HTMLDivElement>(null);
	const commands = channel ? foldShellEvents(channel.events) : [];
	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new card
	useEffect(() => {
		bottomRef.current?.scrollIntoView?.({ block: "end" });
	}, [commands.length]);
	if (!channel) {
		return <ShellHint>连接会话后即可在工作区运行命令。</ShellHint>;
	}
	if (!channel.enabled) {
		return (
			<ShellHint>
				当前 CLI 版本过旧，暂不支持 Shell。请升级 agent CLI 后重试。
			</ShellHint>
		);
	}
	if (commands.length === 0) {
		return <ShellHint>在下方输入命令，在 agent 工作区中执行。</ShellHint>;
	}
	return (
		<div className="flex flex-col gap-2 p-3 sm:p-4">
			{commands.map((tool) => (
				<BashCommandCard key={tool.callId} tool={tool} />
			))}
			<div ref={bottomRef} />
		</div>
	);
}

/** The `$`-prefixed command input row — a tinted, borderless mono field to
 * match the terminal language, with an inline Run affordance. */
function ShellInputRow({
	disabled,
	onRun,
}: {
	disabled: boolean;
	onRun: (command: string) => void;
}) {
	const [value, setValue] = useState("");
	const submit = (event: FormEvent) => {
		event.preventDefault();
		const command = value.trim();
		if (command === "" || disabled) {
			return;
		}
		onRun(command);
		setValue("");
	};
	return (
		// `pb-safe-composer` (<md) clears the home indicator — the workspace route
		// is immersive, so nothing else reserves that space under this row.
		<form
			className="flex shrink-0 items-center gap-2 border-muted/60 border-t px-3 pt-2 pb-safe-composer sm:px-4 md:pb-2"
			onSubmit={submit}
		>
			<span
				aria-hidden
				className="select-none font-mono font-semibold text-emerald-500"
			>
				$
			</span>
			<input
				aria-label="Shell command"
				className="min-w-0 flex-1 bg-transparent font-mono text-foreground text-xs outline-none placeholder:text-muted-foreground disabled:opacity-50"
				disabled={disabled}
				onChange={(event) => setValue(event.target.value)}
				placeholder={disabled ? "Shell 不可用" : "输入命令后回车运行"}
				spellCheck={false}
				value={value}
			/>
			<Button
				aria-label="Run command"
				disabled={disabled || value.trim() === ""}
				size="icon-sm"
				type="submit"
				variant="ghost"
			>
				<CornerDownLeftIcon className="size-4" />
			</Button>
		</form>
	);
}

/** The Shell tab pane. Mounted as a hidden/flex sibling of the chat pane
 * (keep-alive), so switching tabs never remounts the terminal. */
export function LocalAgentShellPane({ hidden }: { hidden: boolean }) {
	const channel = useShellChannel();
	const disabled = !channel?.enabled;
	const run = (command: string) => {
		channel?.run(command).catch(() => toast.error(RUN_FAILURE_MESSAGE));
	};
	return (
		<div className={hidden ? "hidden" : "flex min-h-0 flex-1 flex-col"}>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<ShellHistory channel={channel} />
			</div>
			<ShellInputRow disabled={disabled} onRun={run} />
		</div>
	);
}
