import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@better-agent/ui/components/avatar";
import { Bubble, BubbleContent } from "@better-agent/ui/components/bubble";
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
import type { AgentClient } from "@jacksonw111/agent-client";
import { BotIcon, TriangleAlertIcon, UserIcon } from "lucide-react";
import { useRef } from "react";

import {
	AssistantActionsRow,
	type SaveImageHandler,
} from "./assistant-actions-row";
import { AttachmentImage } from "./attachment-image";
import { type ChatBlock, type ChatMessage, messageText } from "./chat-blocks";
import type { RenderTool, RenderToolResult } from "./tool";
import { ToolGroup } from "./tool";

export type { SaveImageHandler } from "./assistant-actions-row";

function BlockView({
	block,
	streaming,
	renderTool,
	renderToolResult,
}: {
	block: ChatBlock;
	streaming: boolean;
	renderTool?: RenderTool;
	renderToolResult?: RenderToolResult;
}) {
	if (block.kind === "reasoning") {
		return (
			<Reasoning isStreaming={streaming} text={block.text}>
				<ReasoningTrigger label="Reasoning" />
				<ReasoningContent>
					<Response isAnimating={streaming}>{block.text}</Response>
				</ReasoningContent>
			</Reasoning>
		);
	}
	if (block.kind === "tool") {
		return (
			<ToolGroup
				renderTool={renderTool}
				renderToolResult={renderToolResult}
				tools={[block.tool]}
			/>
		);
	}
	if (block.kind === "text") {
		return <Response isAnimating={streaming}>{block.text}</Response>;
	}
	// `file` blocks belong to user messages and render outside the assistant body.
	return null;
}

function AssistantContent({
	message,
	streaming,
	renderTool,
	renderToolResult,
}: {
	message: ChatMessage;
	streaming: boolean;
	renderTool?: RenderTool;
	renderToolResult?: RenderToolResult;
}) {
	return (
		// Space the blocks apart so reasoning, tool calls, rendered genui cards,
		// and answer text read as distinct sections instead of one glued column.
		<div className="flex flex-col gap-3">
			{message.blocks.map((block, index) => (
				<BlockView
					block={block}
					// biome-ignore lint/suspicious/noArrayIndexKey: blocks are append-only and never reorder
					key={`${index}-${block.kind}`}
					renderTool={renderTool}
					renderToolResult={renderToolResult}
					streaming={streaming}
				/>
			))}
		</div>
	);
}

// Only the LIVE draft shimmers "Thinking…"; a refetched (or stopped/orphaned)
// message stuck in `streaming` status must not shimmer forever.
function isThinking(message: ChatMessage): boolean {
	return (
		message.live === true &&
		message.status === "streaming" &&
		message.blocks.length === 0
	);
}

function AssistantBody({
	message,
	renderTool,
	renderToolResult,
	onSaveImage,
}: {
	message: ChatMessage;
	renderTool?: RenderTool;
	renderToolResult?: RenderToolResult;
	onSaveImage?: SaveImageHandler;
}) {
	const streaming = message.status === "streaming";
	const fullText = messageText(message);
	const showThinking = isThinking(message);
	// Captures exactly the rendered answer (text + genui blocks) — excludes
	// the "Thinking…" shimmer, error banner, and the actions row itself.
	const contentRef = useRef<HTMLDivElement>(null);
	return (
		<div className="flex flex-col gap-2">
			{showThinking ? (
				// h-8 matches the size-8 avatar, so the shimmer sits vertically
				// centered beside it instead of hugging the top of the row.
				<div className="flex h-8 items-center">
					<span className="shimmer font-medium text-sm">Thinking…</span>
				</div>
			) : null}
			<div ref={contentRef}>
				<AssistantContent
					message={message}
					renderTool={renderTool}
					renderToolResult={renderToolResult}
					streaming={streaming}
				/>
			</div>
			{message.status === "stopped" ? (
				<span className="text-muted-foreground text-sm">Stopped.</span>
			) : null}
			{message.status === "error" ? (
				<div className="flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-destructive text-sm">
					<TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
					<span>
						{message.errorText ?? "Something went wrong. Please try again."}
					</span>
				</div>
			) : null}
			<AssistantActionsRow
				contentRef={contentRef}
				fullText={fullText}
				message={message}
				onSaveImage={onSaveImage}
			/>
		</div>
	);
}

/** Avatar image URLs for the two roles; falls back to role icons when absent. */
export interface ChatAvatars {
	assistant?: string;
	user?: string;
}

function RoleAvatar({
	from,
	avatars,
}: {
	from: "user" | "assistant";
	avatars?: ChatAvatars;
}) {
	const src = from === "user" ? avatars?.user : avatars?.assistant;
	return (
		<MessageAvatar>
			<Avatar>
				{src ? <AvatarImage alt={from} src={src} /> : null}
				<AvatarFallback>
					{from === "user" ? (
						<UserIcon className="size-4" />
					) : (
						<BotIcon className="size-4" />
					)}
				</AvatarFallback>
			</Avatar>
		</MessageAvatar>
	);
}

function fileBlocks(
	message: ChatMessage
): Extract<ChatBlock, { kind: "file" }>[] {
	return message.blocks.filter(
		(b): b is Extract<ChatBlock, { kind: "file" }> => b.kind === "file"
	);
}

function UserRow({
	message,
	agentClient,
	avatars,
}: {
	message: ChatMessage;
	// Optional so non-chat callers (e.g. the local-agent terminal, whose user
	// turns never carry file attachments) can reuse this row without an
	// AgentClient. Chat always passes one, so its behavior is unchanged.
	agentClient?: AgentClient;
	avatars?: ChatAvatars;
}) {
	const text = messageText(message);
	const files = fileBlocks(message);
	return (
		<Message align="end">
			<RoleAvatar avatars={avatars} from="user" />
			<MessageContent>
				{files.length > 0 && agentClient ? (
					<div className="flex flex-wrap justify-end gap-2">
						{files.map((b) => (
							<AttachmentImage
								agentClient={agentClient}
								file={b.file}
								key={b.file.attachmentId}
							/>
						))}
					</div>
				) : null}
				{text.length > 0 ? (
					<Bubble align="end">
						<BubbleContent className="whitespace-pre-wrap text-sm">
							{text}
						</BubbleContent>
					</Bubble>
				) : null}
			</MessageContent>
		</Message>
	);
}

export function ChatRow({
	message,
	agentClient,
	avatars,
	renderTool,
	renderToolResult,
	onSaveImage,
}: {
	message: ChatMessage;
	agentClient?: AgentClient;
	avatars?: ChatAvatars;
	renderTool?: RenderTool;
	renderToolResult?: RenderToolResult;
	onSaveImage?: SaveImageHandler;
}) {
	if (message.role === "user") {
		return (
			<UserRow agentClient={agentClient} avatars={avatars} message={message} />
		);
	}
	return (
		<Message align="start">
			<RoleAvatar avatars={avatars} from="assistant" />
			<MessageContent>
				<Bubble variant="ghost">
					<BubbleContent className="text-sm">
						<AssistantBody
							message={message}
							onSaveImage={onSaveImage}
							renderTool={renderTool}
							renderToolResult={renderToolResult}
						/>
					</BubbleContent>
				</Bubble>
			</MessageContent>
		</Message>
	);
}

export type { RenderTool, RenderToolResult } from "./tool";
