import {
	MessageScroller,
	MessageScrollerButton,
	MessageScrollerContent,
	MessageScrollerItem,
	MessageScrollerProvider,
	MessageScrollerViewport,
} from "@better-agent/ui/components/message-scroller";
import type { AgentClient } from "@jacksonw111/agent-client";
import type { ReactNode } from "react";
import { useEffect, useLayoutEffect, useRef } from "react";

import type { ChatMessage } from "./chat-blocks";
import { ChatComposer } from "./chat-composer";
import { type ChatAvatars, ChatRow, type RenderToolResult } from "./chat-row";
import { RevealText } from "./reveal-text";
import { useChat } from "./use-chat";

function EmptyMessages() {
	return (
		<div className="flex flex-col items-center justify-center py-24 text-center">
			<RevealText>
				<p className="t-stagger-line t-stagger-line--1 font-medium text-sm">
					Start the conversation
				</p>
				<p className="t-stagger-line t-stagger-line--2 text-muted-foreground text-sm">
					Send a message to begin.
				</p>
			</RevealText>
		</div>
	);
}

function ChatScroller({
	messages,
	agentClient,
	avatars,
	renderToolResult,
}: {
	messages: ChatMessage[];
	agentClient: AgentClient;
	avatars?: ChatAvatars;
	renderToolResult?: RenderToolResult;
}) {
	return (
		<MessageScrollerProvider autoScroll defaultScrollPosition="end">
			<MessageScroller>
				<MessageScrollerViewport>
					<MessageScrollerContent className="mx-auto w-full max-w-3xl px-3 py-4 sm:px-4">
						{messages.length === 0 ? (
							<EmptyMessages />
						) : (
							messages.map((message, index) => (
								// POSITIONAL keys on purpose: chat is append-only, and at turn
								// completion the draft rows are swapped for their persisted
								// twins with NEW ids — id keys would unmount/remount every row
								// (avatars flash, markdown re-parses, the list visibly blinks).
								// Position keeps the swap an in-place update. No scrollAnchor:
								// it inserts a spacer that fights follow-bottom autoScroll.
								// biome-ignore lint/suspicious/noArrayIndexKey: append-only list; stability across the draft->history id swap is the point
								<MessageScrollerItem key={index}>
									<ChatRow
										agentClient={agentClient}
										avatars={avatars}
										message={message}
										renderToolResult={renderToolResult}
									/>
								</MessageScrollerItem>
							))
						)}
					</MessageScrollerContent>
				</MessageScrollerViewport>
				<MessageScrollerButton />
			</MessageScroller>
		</MessageScrollerProvider>
	);
}

// Send the first message once the chat mounts. Defer it: a transient
// mount/unmount during the composer→chat slide (or a dev double-invoke) cancels
// the stale schedule via cleanup instead of aborting an already-started stream —
// so the send fires exactly once, after things settle, and is never lost.
function useInitialSend(
	initialText: string | undefined,
	send: (text: string) => void
) {
	const sendRef = useRef(send);
	useLayoutEffect(() => {
		sendRef.current = send;
	});
	useEffect(() => {
		const id = initialText
			? setTimeout(() => sendRef.current(initialText), 0)
			: undefined;
		return () => {
			if (id !== undefined) {
				clearTimeout(id);
			}
		};
	}, [initialText]);
}

export function Conversation({
	sessionId,
	agentClient,
	initialText,
	avatars,
	composerTools,
	renderToolResult,
}: {
	sessionId: string;
	agentClient: AgentClient;
	initialText?: string;
	avatars?: ChatAvatars;
	composerTools?: ReactNode;
	renderToolResult?: RenderToolResult;
}) {
	const { messages, streaming, send, stop } = useChat(sessionId, agentClient);
	useInitialSend(initialText, send);
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<ChatScroller
				agentClient={agentClient}
				avatars={avatars}
				messages={messages}
				renderToolResult={renderToolResult}
			/>
			<ChatComposer
				agentClient={agentClient}
				onSend={send}
				onStop={stop}
				sessionId={sessionId}
				streaming={streaming}
				toolsSlot={composerTools}
			/>
		</div>
	);
}
