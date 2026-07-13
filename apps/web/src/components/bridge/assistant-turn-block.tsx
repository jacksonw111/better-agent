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
import { groupTurnBlocks, type TurnElement } from "./activity-blocks";
import { ActivityGroup } from "./activity-group";
import { SpineItem, toneOfGroup, toneOfTool } from "./activity-spine-dot";
import { renderActivityTool } from "./bridge-tool-card";

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

function TurnElementView({
	element,
	streaming,
}: {
	element: TurnElement;
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

export function AssistantTurnBlock({
	message,
	avatars,
}: {
	message: ChatMessage;
	avatars?: ChatAvatars;
}) {
	const streaming = message.status === "streaming";
	const fullText = messageText(message);
	const elements = groupTurnBlocks(message.blocks);
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
								{elements.map((element) => (
									<TurnElementView
										// P1-T2: `element.key` is group-aware and stable across
										// streaming (see activity-blocks.ts) — loose tools folding
										// into a group no longer remounts every later sibling, and
										// a growing group keeps its expand state.
										element={element}
										key={element.key}
										streaming={streaming}
									/>
								))}
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
