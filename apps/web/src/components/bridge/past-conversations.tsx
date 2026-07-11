import { CopyAction } from "@better-agent/ui/components/actions";
import { Button } from "@better-agent/ui/components/button";
import {
	Popover,
	PopoverContent,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "@better-agent/ui/components/popover";
import { HistoryIcon } from "lucide-react";
import { useState } from "react";
import type { SessionListDetail, SessionListItem } from "./bridge-session-list";
import { formatSessionTimestamp } from "./local-agent-format";
import { bridgeResumeCliCommand, PLACEHOLDER_TOKEN } from "./local-agent-join";

// Read-only for now: this picker surfaces past claude conversations and gives
// a copy-able `--resume` command, but doesn't itself relaunch the CLI —
// actually one-click-resuming a session (spawning/reconnecting a local CLI
// process from the browser) is out of scope for this pass. See the Phase 3
// plan doc.

function SessionListRow({ item }: { item: SessionListItem }) {
	const command = bridgeResumeCliCommand(PLACEHOLDER_TOKEN, item.cwd, item.id);
	return (
		<div className="flex flex-col gap-1 rounded-md border p-2">
			<div className="flex items-center justify-between gap-2">
				<span className="min-w-0 flex-1 truncate font-medium text-xs">
					{item.title}
				</span>
				{item.gitBranch && (
					<span className="shrink-0 text-muted-foreground text-xs">
						{item.gitBranch}
					</span>
				)}
			</div>
			{item.lastModified !== undefined && (
				<span className="text-muted-foreground text-xs">
					{formatSessionTimestamp(new Date(item.lastModified))}
				</span>
			)}
			<div className="flex items-center gap-1.5">
				<code className="block w-full overflow-x-auto whitespace-nowrap rounded border bg-muted px-1.5 py-1 font-mono text-xs">
					{command}
				</code>
				<CopyAction label="Copy resume command" text={command} />
			</div>
		</div>
	);
}

function SessionListBody({ detail }: { detail: SessionListDetail | null }) {
	if (detail === null) {
		return (
			<p className="text-muted-foreground text-xs">
				Loading past conversations…
			</p>
		);
	}
	if (detail.sessions.length === 0) {
		return (
			<p className="text-muted-foreground text-xs">
				No past conversations found for this directory.
			</p>
		);
	}
	return (
		<div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
			{detail.sessions.map((item) => (
				<SessionListRow item={item} key={item.id} />
			))}
		</div>
	);
}

export interface PastConversationsProps {
	disabled: boolean;
	onRequestList: () => void;
	sessionList: SessionListDetail | null;
}

/**
 * The Local Agent detail page's "Past conversations" button: on open, asks
 * the CLI for its local claude conversation list (`{ control: listSessions
 * }`, answered asynchronously as a `session_list` status event — see
 * use-bridge-terminal.ts) and renders whatever's arrived as a small popover
 * list, each item with a copy-able `--resume` hint. Read-only: picking one
 * doesn't relaunch the session here, it just gives the exact command to run
 * locally (full one-click resume is deferred).
 */
export function PastConversations({
	disabled,
	onRequestList,
	sessionList,
}: PastConversationsProps) {
	const [open, setOpen] = useState(false);
	return (
		<Popover
			onOpenChange={(next) => {
				setOpen(next);
				if (next) {
					onRequestList();
				}
			}}
			open={open}
		>
			<PopoverTrigger
				render={
					<Button
						aria-label="Past conversations"
						disabled={disabled}
						size="xs"
						variant="outline"
					/>
				}
			>
				<HistoryIcon />
				Past conversations
			</PopoverTrigger>
			<PopoverContent className="w-80">
				<PopoverHeader>
					<PopoverTitle>Past conversations</PopoverTitle>
				</PopoverHeader>
				<SessionListBody detail={sessionList} />
			</PopoverContent>
		</Popover>
	);
}
