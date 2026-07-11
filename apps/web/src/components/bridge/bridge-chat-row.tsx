import type { ChatMessage } from "@better-agent/ui/components/chat/chat-blocks";
import {
	type ChatAvatars,
	ChatRow,
} from "@better-agent/ui/components/chat/chat-row";
import { memo } from "react";
import { AssistantTurnBlock } from "./assistant-turn-block";
import type { AssistantTurn, BridgeTurn, UserTurn } from "./bridge-turns";
import { ApprovalLine, ErrorLine, FileLine, StatusLine } from "./event-line";
import { QuestionCard } from "./question-card";
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
	/** requestId -> submitted answers, for questions already answered (R3-T3).
	 * Mirrors `answered` above. */
	answeredQuestions: Record<string, string[][]>;
	/** When true, shimmer skeleton lines are appended right under this assistant
	 * message — attached (indented to the text column) so it reads as "this
	 * message is still being produced". Only set on the trailing in-flight
	 * assistant turn by `TerminalFeed`. */
	attachSkeleton?: boolean;
	avatars?: ChatAvatars;
	/** True once the session has ended — suppresses the streaming caret. */
	ended: boolean;
	onAnswerApproval: (requestId: string, optionId: string) => void;
	/** R3-T3: mirrors `onAnswerApproval` for a `question` turn. */
	onAnswerQuestion: (requestId: string, answers: string[][]) => void;
	turn: BridgeTurn;
}

/** The same shimmering "Thinking…" text `ChatRow` (packages/ui) shows for a
 * live draft with no blocks yet, attached under the trailing in-flight
 * assistant message instead: indented past the avatar column (`pl-9` ≈ avatar
 * + row gap) so it sits directly under the message text, and tucked up with a
 * small negative margin so it reads as a continuation of the bubble above
 * rather than a separate row. Decorative — hidden from assistive tech (the
 * streaming caret already conveys state). R1-T1: replaces the old
 * `.working-shimmer` bar pair so this and `WorkingSkeleton` (terminal-feed.tsx)
 * read as the same visual language. */
function StreamingSkeleton() {
	return (
		<div aria-hidden className="-mt-0.5 pl-9">
			<span className="shimmer font-medium text-sm">Thinking…</span>
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
/** The assistant bubble plus its optional attached "still producing" skeleton
 * — split out of `BridgeChatRowImpl` purely to keep that switch under the
 * repo's max-lines-per-function gate. */
function AssistantWithSkeleton({
	attachSkeleton,
	avatars,
	ended,
	turn,
}: {
	attachSkeleton?: boolean;
	avatars?: ChatAvatars;
	ended: boolean;
	turn: AssistantTurn;
}) {
	return (
		<>
			<AssistantTurnBlock
				avatars={avatars}
				message={assistantMessage(turn, ended)}
			/>
			{attachSkeleton && <StreamingSkeleton />}
		</>
	);
}

function BridgeChatRowImpl({
	answered,
	answeredQuestions,
	attachSkeleton,
	avatars,
	ended,
	onAnswerApproval,
	onAnswerQuestion,
	turn,
}: BridgeChatRowProps) {
	switch (turn.kind) {
		case "user":
			return <ChatRow avatars={avatars} message={userMessage(turn)} />;
		case "assistant":
			return (
				<AssistantWithSkeleton
					attachSkeleton={attachSkeleton}
					avatars={avatars}
					ended={ended}
					turn={turn}
				/>
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
		case "approval":
			return (
				<ApprovalLine
					answeredOptionId={answered[turn.event.requestId]}
					event={turn.event}
					onAnswer={onAnswerApproval}
				/>
			);
		default:
			return (
				<QuestionCard
					answered={answeredQuestions[turn.event.requestId]}
					event={turn.event}
					onAnswer={onAnswerQuestion}
				/>
			);
	}
}

export const BridgeChatRow = memo(BridgeChatRowImpl);
