import { Button } from "@better-agent/ui/components/button";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import type { GitChannel } from "./git-channel-store";

// P4-T4: the Git pane's bottom commit box. v1 deliberately has NO staging UI
// (phase 2) — the CLI runs `git add -A` before committing, and the button
// says so ("提交全部变更") so nothing is staged silently.

/** Fires the commit and settles the box's state — toast + clear + the pane's
 * refresh on success, toast on failure. Module-level (not a closure inside
 * the component) to keep `GitCommitBox` under the max-lines-per-function
 * gate. */
function runCommit(
	channel: GitChannel,
	message: string,
	done: {
		onCommitted: () => void;
		setMessage: (m: string) => void;
		setPending: (p: boolean) => void;
	}
): void {
	channel.commit(message).then(
		(result) => {
			done.setPending(false);
			done.setMessage("");
			toast.success(result.hash ? `已提交 ${result.hash}` : "已提交全部变更");
			done.onCommitted();
		},
		(error: unknown) => {
			done.setPending(false);
			toast.error(error instanceof Error ? error.message : "提交失败，请重试");
		}
	);
}

export function GitCommitBox({
	channel,
	disabled,
	onCommitted,
}: {
	channel: GitChannel;
	/** True while the tree is clean / status hasn't loaded — nothing to commit. */
	disabled: boolean;
	/** Success hook: the pane refreshes its status list (and closes the diff —
	 * the committed paths just vanished from it). */
	onCommitted: () => void;
}) {
	const [message, setMessage] = useState("");
	const [pending, setPending] = useState(false);
	const blocked = disabled || pending || message.trim() === "";

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (blocked) {
			return;
		}
		setPending(true);
		runCommit(channel, message.trim(), {
			onCommitted,
			setMessage,
			setPending,
		});
	};

	return (
		<form
			className="flex shrink-0 items-end gap-2 px-3 py-2 sm:px-4"
			onSubmit={submit}
		>
			<textarea
				aria-label="Commit message"
				className="min-h-9 min-w-0 flex-1 resize-none rounded-md bg-muted/40 px-3 py-2 text-foreground text-xs outline-none transition-colors placeholder:text-muted-foreground focus:bg-muted/60 disabled:opacity-50"
				disabled={disabled || pending}
				onChange={(event) => setMessage(event.target.value)}
				placeholder="输入提交信息（将提交工作区全部变更）"
				rows={1}
				spellCheck={false}
				value={message}
			/>
			<Button disabled={blocked} size="sm" type="submit" variant="secondary">
				{pending ? "提交中…" : "提交全部变更"}
			</Button>
		</form>
	);
}
