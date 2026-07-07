import type { ChatMessage } from "@better-agent/ui/components/chat/chat-blocks";
import {
	type ChatAvatars,
	ChatRow,
} from "@better-agent/ui/components/chat/chat-row";
import { memo } from "react";
import type { AssistantTurn, BridgeTurn, UserTurn } from "./bridge-turns";
import { ApprovalLine, ErrorLine, FileLine, StatusLine } from "./event-line";
import { TaskCard } from "./task-card";
import { TodoList } from "./todo-list";

/** The trailing open assistant turn streams a caret — but only while the
 * session is still live; an ended session shows a settled, complete bubble. */
function assistantMessage(turn: AssistantTurn, ended: boolean): ChatMessage {
	const streaming = turn.streaming && !ended;
	return {
		id: String(turn.id),
		role: "assistant",
		status: streaming ? "streaming" : "complete",
		blocks: turn.blocks,
		live: streaming,
	};
}

function userMessage(turn: UserTurn): ChatMessage {
	return {
		id: String(turn.id),
		role: "user",
		status: "complete",
		blocks: [{ kind: "text", text: turn.text }],
	};
}

export interface BridgeChatRowProps {
	/** requestId -> chosen optionId, for approvals already answered. */
	answered: Record<string, string>;
	/** When true, shimmer skeleton lines are appended right under this assistant
	 * message — attached (indented to the text column) so it reads as "this
	 * message is still being produced". Only set on the trailing in-flight
	 * assistant turn by `TerminalFeed`. */
	attachSkeleton?: boolean;
	avatars?: ChatAvatars;
	/** True once the session has ended — suppresses the streaming caret. */
	ended: boolean;
	onAnswerApproval: (requestId: string, optionId: string) => void;
	/** True while a sendInput mutation is in flight — gates approval buttons. */
	sending: boolean;
	turn: BridgeTurn;
}

/** Shimmer lines attached to the trailing in-flight assistant message. Indented
 * past the avatar column (`pl-9` ≈ avatar + row gap) so they sit directly under
 * the message text, and tucked up with a small negative margin so the skeleton
 * reads as a continuation of the bubble above rather than a separate row.
 * Decorative — hidden from assistive tech (the streaming caret + "Thinking…"
 * already convey state). */
function StreamingSkeleton() {
	return (
		<div aria-hidden className="-mt-0.5 flex flex-col gap-1.5 pl-9">
			<div className="working-shimmer h-3 w-3/4 rounded" />
			<div className="working-shimmer h-3 w-2/5 rounded" />
		</div>
	);
}

/**
 * Renders one folded bridge turn with the SAME components as the normal chat:
 * user/assistant turns as chat bubbles (avatars, markdown, tool cards), and
 * the lifecycle kinds as subtle inline lines. Approval stays the bridge's own
 * card, sitting inside the assistant flow.
 *
 * `memo`'d: a streaming session re-renders the feed on every token, but each
 * already-settled turn's props (its `turn` object, avatars, answered map) are
 * stable across those renders, so the shallow-prop guard skips re-rendering
 * every prior row — only the trailing, actually-changing turn re-renders.
 */
function BridgeChatRowImpl({
	answered,
	attachSkeleton,
	avatars,
	ended,
	onAnswerApproval,
	sending,
	turn,
}: BridgeChatRowProps) {
	switch (turn.kind) {
		case "user":
			return <ChatRow avatars={avatars} message={userMessage(turn)} />;
		case "assistant":
			return (
				<>
					<ChatRow avatars={avatars} message={assistantMessage(turn, ended)} />
					{attachSkeleton && <StreamingSkeleton />}
				</>
			);
		case "status":
			return <StatusLine event={turn.event} />;
		case "error":
			return <ErrorLine event={turn.event} />;
		case "file":
			return <FileLine event={turn.event} />;
		case "task":
			return <TaskCard task={turn.task} />;
		case "plan":
			return <TodoList items={turn.items} />;
		default:
			return (
				<ApprovalLine
					answeredOptionId={answered[turn.event.requestId]}
					event={turn.event}
					onAnswer={onAnswerApproval}
					pending={sending}
				/>
			);
	}
}

export const BridgeChatRow = memo(BridgeChatRowImpl);
