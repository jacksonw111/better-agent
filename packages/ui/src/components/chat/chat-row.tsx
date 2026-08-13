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
import { ToolGroup } from "./tool";
import type { ToolRegistry } from "./tool-registry";

export type { SaveImageHandler } from "./assistant-actions-row";

function BlockView({
	block,
	streaming,
	toolRegistry,
}: {
	block: ChatBlock;
	streaming: boolean;
	toolRegistry?: ToolRegistry;
}) {
	if (block.kind === "reasoning") {
		return (
			<Reasoning isStreaming={streaming} text={block.text}>
				<ReasoningTrigger
					isStreaming={streaming}
					label={streaming ? "Thinking" : "Reasoning"}
				/>
				<ReasoningContent>
					<Response isAnimating={streaming}>{block.text}</Response>
				</ReasoningContent>
			</Reasoning>
		);
	}
	if (block.kind === "tool") {
		return <ToolGroup toolRegistry={toolRegistry} tools={[block.tool]} />;
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
	toolRegistry,
}: {
	message: ChatMessage;
	streaming: boolean;
	toolRegistry?: ToolRegistry;
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
					streaming={streaming}
					toolRegistry={toolRegistry}
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
	toolRegistry,
	onSaveImage,
}: {
	message: ChatMessage;
	toolRegistry?: ToolRegistry;
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
					<span className="bui-shimmer font-medium text-sm">Thinking…</span>
				</div>
			) : null}
			<div ref={contentRef}>
				<AssistantContent
					message={message}
					streaming={streaming}
					toolRegistry={toolRegistry}
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
		<Message align="end" className="bui-fade-up">
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
					// beautifului.dev user bubble: a quiet field-toned bubble with
					// normal ink, not an inverted primary block.
					<Bubble align="end" variant="muted">
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
	toolRegistry,
	onSaveImage,
}: {
	message: ChatMessage;
	agentClient?: AgentClient;
	avatars?: ChatAvatars;
	/** The app's rich tool-card registry (P1-T1's single seam) — cloud passes
	 * `cloudToolRegistry` (genui result cards), the local terminal passes
	 * `bridgeToolRegistry` (terminal-style ActivityItems). Unset or unclaimed,
	 * tools keep the default plain collapsible block. */
	toolRegistry?: ToolRegistry;
	onSaveImage?: SaveImageHandler;
}) {
	if (message.role === "user") {
		return (
			<UserRow agentClient={agentClient} avatars={avatars} message={message} />
		);
	}
	return (
		<Message align="start" className="bui-fade-up">
			<RoleAvatar avatars={avatars} from="assistant" />
			<MessageContent>
				<Bubble variant="ghost">
					<BubbleContent className="text-sm">
						<AssistantBody
							message={message}
							onSaveImage={onSaveImage}
							toolRegistry={toolRegistry}
						/>
					</BubbleContent>
				</Bubble>
			</MessageContent>
		</Message>
	);
}

export type { ToolRegistry, ToolRegistryEntry } from "./tool-registry";
