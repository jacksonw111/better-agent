import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@better-agent/ui/components/avatar";
import { Bubble, BubbleContent } from "@better-agent/ui/components/bubble";
import { AssistantActionsRow } from "@better-agent/ui/components/chat/assistant-actions-row";
import {
	type ChatMessage,
	messageText,
} from "@better-agent/ui/components/chat/chat-blocks";
import type { ChatAvatars } from "@better-agent/ui/components/chat/chat-row";
import {
	Message,
	MessageAvatar,
	MessageContent,
} from "@better-agent/ui/components/message";
import {
	Reasoning,
	ReasoningContent,
	ReasoningTrigger,
} from "@better-agent/ui/components/reasoning";
import { Response } from "@better-agent/ui/components/response";
import { BotIcon } from "lucide-react";
import { useRef } from "react";
import { useClientPref } from "@/utils/preferences";
import { groupTurnBlocks, type TurnElement } from "./activity-blocks";
import { ActivityGroup } from "./activity-group";
import { SpineItem, toneOfGroup, toneOfTool } from "./activity-spine-dot";
import { renderActivityTool } from "./bridge-tool-card";
import { ApprovalLine } from "./event-line";
import { isExitPlanModeApproval, PlanApprovalCard } from "./plan-approval-card";
import { QuestionCard } from "./question-card";

// R1-T3: the local-agent terminal's TurnBlock — ONE avatar plus a single
// spine (a left border on the content column) that every block of the turn
// hangs off of, in arrival order: prose (Response/Reasoning, same as the
// normal chat) and activity items (ActivityItem/ActivityGroup, each with its
// own status dot on the spine) interleave exactly as the agent produced
// them, instead of prose-then-tools-batched-separately.

function AssistantAvatar({ avatars }: { avatars?: ChatAvatars }) {
	return (
		<MessageAvatar>
			<Avatar>
				{avatars?.assistant ? (
					<AvatarImage alt="assistant" src={avatars.assistant} />
				) : null}
				<AvatarFallback>
					<BotIcon className="size-4" />
				</AvatarFallback>
			</Avatar>
		</MessageAvatar>
	);
}

/** The spine element kinds `TurnElementView` handles — everything EXCEPT the
 * approval/question requests (those route to `RequestElementView` in the
 * element map). Typing the param this way lets the trailing toolGroup branch
 * narrow correctly. */
type SpineElement = Exclude<
	TurnElement,
	{ kind: "approval" } | { kind: "question" }
>;

function TurnElementView({
	element,
	streaming,
}: {
	element: SpineElement;
	streaming: boolean;
}) {
	if (element.kind === "text") {
		return <Response isAnimating={streaming}>{element.text}</Response>;
	}
	if (element.kind === "reasoning") {
		return (
			<Reasoning isStreaming={streaming} text={element.text}>
				<ReasoningTrigger label="Reasoning" />
				<ReasoningContent>
					<Response isAnimating={streaming}>{element.text}</Response>
				</ReasoningContent>
			</Reasoning>
		);
	}
	if (element.kind === "tool") {
		return (
			<SpineItem tone={toneOfTool(element.tool)}>
				{renderActivityTool(element.tool)}
			</SpineItem>
		);
	}
	return (
		<SpineItem tone={toneOfGroup(element.tools)}>
			<ActivityGroup toolName={element.sameToolName} tools={element.tools} />
		</SpineItem>
	);
}

/** A pending approval/question request, rendered inline on the message's
 * spine as a block (same column as a tool call) so it shares the avatar +
 * spine instead of breaking the line. Plan-mode (ExitPlanMode) renders the
 * rich plan card; every other approval renders the generic line. Split out of
 * `TurnElementView` purely to keep both under the repo's
 * max-lines-per-function gate. */
function RequestElementView({
	element,
	answered,
	answeredQuestions,
	onAnswerApproval,
	onAnswerQuestion,
}: {
	element: Extract<TurnElement, { kind: "approval" | "question" }>;
	answered: Record<string, string>;
	answeredQuestions: Record<string, string[][]>;
	onAnswerApproval: (requestId: string, optionId: string) => void;
	onAnswerQuestion: (requestId: string, answers: string[][]) => void;
}) {
	if (element.kind === "approval") {
		return isExitPlanModeApproval(element.approval) ? (
			<PlanApprovalCard
				answeredOptionId={answered[element.approval.requestId]}
				event={element.approval}
				onAnswer={onAnswerApproval}
			/>
		) : (
			<ApprovalLine
				answeredOptionId={answered[element.approval.requestId]}
				event={element.approval}
				onAnswer={onAnswerApproval}
			/>
		);
	}
	return (
		<QuestionCard
			answered={answeredQuestions[element.question.requestId]}
			event={element.question}
			onAnswer={onAnswerQuestion}
		/>
	);
}

interface AssistantTurnBlockProps {
	/** requestId → chosen optionId for approvals already answered. Threaded
	 * down so an approval block embedded in this message renders its answered
	 * state. */
	answered: Record<string, string>;
	/** requestId → submitted answers for questions already answered. */
	answeredQuestions: Record<string, string[][]>;
	avatars?: ChatAvatars;
	message: ChatMessage;
	onAnswerApproval: (requestId: string, optionId: string) => void;
	onAnswerQuestion: (requestId: string, answers: string[][]) => void;
}

/** The turn's spine elements, each dispatched to its renderer — prose/tools
 * to `TurnElementView`, embedded approval/question requests to
 * `RequestElementView`. Split out of `AssistantTurnBlock` to keep both under
 * the repo's max-lines-per-function gate. */
function SpineElements({
	elements,
	streaming,
	answered,
	answeredQuestions,
	onAnswerApproval,
	onAnswerQuestion,
}: {
	elements: TurnElement[];
	streaming: boolean;
	answered: Record<string, string>;
	answeredQuestions: Record<string, string[][]>;
	onAnswerApproval: (requestId: string, optionId: string) => void;
	onAnswerQuestion: (requestId: string, answers: string[][]) => void;
}) {
	return elements.map((element) =>
		element.kind === "approval" || element.kind === "question" ? (
			<RequestElementView
				answered={answered}
				answeredQuestions={answeredQuestions}
				element={element}
				key={element.key}
				onAnswerApproval={onAnswerApproval}
				onAnswerQuestion={onAnswerQuestion}
			/>
		) : (
			<TurnElementView
				// P1-T2: `element.key` is group-aware and stable across streaming
				// (see activity-blocks.ts) — loose tools folding into a group no
				// longer remounts every later sibling, and a growing group keeps
				// its expand state.
				element={element}
				key={element.key}
				streaming={streaming}
			/>
		)
	);
}

export function AssistantTurnBlock({
	message,
	avatars,
	answered,
	answeredQuestions,
	onAnswerApproval,
	onAnswerQuestion,
}: AssistantTurnBlockProps) {
	const streaming = message.status === "streaming";
	const fullText = messageText(message);
	// P2-T4: `showThinking=false` drops the reasoning TEXT blocks from this
	// (local-feed-only) spine. The in-flight "Thinking…" shimmer is a status
	// signal, not content, and lives elsewhere (bridge-chat-row/terminal-feed)
	// — it stays regardless. Cloud chat rendering is untouched.
	const showThinking = useClientPref("showThinking");
	const elements = groupTurnBlocks(message.blocks).filter(
		(element) => showThinking || element.kind !== "reasoning"
	);
	const contentRef = useRef<HTMLDivElement>(null);
	return (
		<Message align="start">
			<AssistantAvatar avatars={avatars} />
			<MessageContent>
				<Bubble variant="ghost">
					<BubbleContent className="text-sm">
						<div className="flex flex-col gap-2">
							<div
								className="flex flex-col gap-1.5 border-l pl-3"
								ref={contentRef}
							>
								<SpineElements
									answered={answered}
									answeredQuestions={answeredQuestions}
									elements={elements}
									onAnswerApproval={onAnswerApproval}
									onAnswerQuestion={onAnswerQuestion}
									streaming={streaming}
								/>
							</div>
							<AssistantActionsRow
								contentRef={contentRef}
								fullText={fullText}
								message={message}
							/>
						</div>
					</BubbleContent>
				</Bubble>
			</MessageContent>
		</Message>
	);
}
