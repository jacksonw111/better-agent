import type { ChatMessage } from "@better-agent/ui/components/chat/chat-blocks";
import {
	type ChatAvatars,
	ChatRow,
} from "@better-agent/ui/components/chat/chat-row";
import { memo } from "react";
import { AssistantTurnBlock } from "./assistant-turn-block";
import type { AssistantTurn, BridgeTurn, UserTurn } from "./bridge-turns";
import {
	ApprovalLine,
	type ApprovalLineProps,
	ErrorLine,
	FileLine,
} from "./event-line";
import { isExitPlanModeApproval, PlanApprovalCard } from "./plan-approval-card";
import { QuestionCard } from "./question-card";
import { StatusLine } from "./status-line";
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

/** P1-T4: an approval turn's row — claude's ExitPlanMode permission request
 * renders as the inline plan card (Build/Revise over the plan markdown), every
 * other approval keeps the generic `ApprovalLine`. Both answer through the
 * same `onAnswer` decision channel. */
function ApprovalTurnRow({
	answeredOptionId,
	event,
	onAnswer,
}: ApprovalLineProps) {
	if (isExitPlanModeApproval(event)) {
		return (
			<PlanApprovalCard
				answeredOptionId={answeredOptionId}
				event={event}
				onAnswer={onAnswer}
			/>
		);
	}
	return (
		<ApprovalLine
			answeredOptionId={answeredOptionId}
			event={event}
			onAnswer={onAnswer}
		/>
	);
}

/** The non-conversational turn kinds — status/error/file lines and the
 * task/plan/approval/question cards. All share ONE left edge: the assistant
 * message's spine. `BridgeChatRowImpl` wraps these in `pl-9` (reserving the
 * avatar column) + `border-l pl-3` (drawing the spine and indenting to the
 * text column), mirroring `AssistantTurnBlock`'s own spine so the vertical
 * line carries through the request cards instead of breaking at them. */
function SideTurn({
	answered,
	answeredQuestions,
	onAnswerApproval,
	onAnswerQuestion,
	turn,
}: {
	answered: Record<string, string>;
	answeredQuestions: Record<string, string[][]>;
	onAnswerApproval: (requestId: string, optionId: string) => void;
	onAnswerQuestion: (requestId: string, answers: string[][]) => void;
	turn: Exclude<BridgeTurn, UserTurn | AssistantTurn>;
}) {
	switch (turn.kind) {
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
				<ApprovalTurnRow
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
		default:
			// The status/error/file lines and task/plan/approval/question cards
			// all hang off the SAME spine as the assistant message: `pl-9`
			// reserves the avatar column, then `border-l pl-3` draws the spine
			// and indents content to the text column — mirroring
			// `AssistantTurnBlock`'s own `border-l pl-3` so the vertical line
			// carries through the request cards instead of breaking at them.
			return (
				<div className="pl-9">
					<div className="border-l pl-3">
						<SideTurn
							answered={answered}
							answeredQuestions={answeredQuestions}
							onAnswerApproval={onAnswerApproval}
							onAnswerQuestion={onAnswerQuestion}
							turn={turn}
						/>
					</div>
				</div>
			);
	}
}

export const BridgeChatRow = memo(BridgeChatRowImpl);
