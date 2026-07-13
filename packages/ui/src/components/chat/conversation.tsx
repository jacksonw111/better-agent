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
import {
	type ChatAvatars,
	ChatRow,
	type SaveImageHandler,
	type ToolRegistry,
} from "./chat-row";
import { RevealText } from "./reveal-text";
import type { SkillPickerItem } from "./skill-picker";
import { useChat } from "./use-chat";

export type { SkillPickerItem } from "./skill-picker";

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
	toolRegistry,
	onSaveImage,
}: {
	messages: ChatMessage[];
	agentClient: AgentClient;
	avatars?: ChatAvatars;
	toolRegistry?: ToolRegistry;
	onSaveImage?: SaveImageHandler;
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
										onSaveImage={onSaveImage}
										toolRegistry={toolRegistry}
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
	toolRegistry,
	onSaveImage,
	skills,
}: {
	sessionId: string;
	agentClient: AgentClient;
	initialText?: string;
	avatars?: ChatAvatars;
	composerTools?: ReactNode;
	/** The app's rich tool-card registry — see `ChatRow`'s prop of the same
	 * name. The web-agent chat passes `cloudToolRegistry`. */
	toolRegistry?: ToolRegistry;
	/** App-supplied "save as image" export — see `SaveImageHandler` in
	 * `chat-row.tsx`. Omitted, the action doesn't render. */
	onSaveImage?: SaveImageHandler;
	/** The agent's assigned skills — feeds the composer's "/" picker (see
	 * `ChatComposer`'s `skills` prop). `undefined` until they've loaded, or
	 * for an agent with none, in which case the picker never opens. */
	skills?: SkillPickerItem[];
}) {
	const { messages, streaming, send, stop } = useChat(sessionId, agentClient);
	useInitialSend(initialText, send);
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<ChatScroller
				agentClient={agentClient}
				avatars={avatars}
				messages={messages}
				onSaveImage={onSaveImage}
				toolRegistry={toolRegistry}
			/>
			<ChatComposer
				agentClient={agentClient}
				onSend={send}
				onStop={stop}
				sessionId={sessionId}
				skills={skills}
				streaming={streaming}
				toolsSlot={composerTools}
			/>
		</div>
	);
}
