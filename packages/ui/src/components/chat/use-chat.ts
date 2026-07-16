import type { AgentClient } from "@jacksonw111/agent-client";
import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

import type { AttachmentRef, ChatBlock, ChatMessage } from "./chat-blocks";
import { toChatMessage } from "./chat-blocks";
import { hasRunningTurn, useObserveTurn } from "./chat-observe";
import { type ChatSessionStore, chatSession } from "./chat-session-store";
import { streamPrompt } from "./chat-stream";

export { streamPrompt } from "./chat-stream";

// Query key for a session's message history, fetched through the Agent SDK
// (token-scoped) rather than the unauthenticated oRPC client.
const messagesKey = (sessionId: string) =>
	["agent", "messages", sessionId] as const;

interface SendArgs {
	agentClient: AgentClient;
	sessionId: string;
	store: ChatSessionStore;
}

function userDraftBlocks(
	text: string,
	attachments: AttachmentRef[]
): ChatBlock[] {
	const blocks: ChatBlock[] = [];
	if (text.length > 0) {
		blocks.push({ kind: "text", text });
	}
	for (const file of attachments) {
		blocks.push({ kind: "file", file });
	}
	return blocks;
}

function initDraft(
	text: string,
	attachments: AttachmentRef[],
	store: ChatSessionStore
): { assistant: ChatMessage; user: ChatMessage } {
	const user: ChatMessage = {
		id: "draft-user",
		role: "user",
		status: "complete",
		blocks: userDraftBlocks(text, attachments),
	};
	const assistant: ChatMessage = {
		id: "draft-assistant",
		role: "assistant",
		status: "streaming",
		blocks: [],
		live: true,
	};
	store.setDraft([user, assistant]);
	return { user, assistant };
}

async function sendMessage(
	text: string,
	attachments: AttachmentRef[],
	args: SendArgs
) {
	if (args.sessionId === "" || args.store.getSnapshot().streaming) {
		return;
	}
	const controller = new AbortController();
	args.store.setController(controller);
	args.store.setStreaming(true);
	const { user, assistant } = initDraft(text, attachments, args.store);
	try {
		await streamPrompt({
			agentClient: args.agentClient,
			sessionId: args.sessionId,
			text,
			signal: controller.signal,
			user,
			assistant,
			setDraft: (msgs) => args.store.setDraft(msgs),
			attachmentIds: attachments.map((a) => a.attachmentId),
		});
	} catch {
		if (!controller.signal.aborted) {
			assistant.status = "error";
			args.store.setDraft([
				user,
				{ ...assistant, blocks: [...assistant.blocks] },
			]);
		}
	} finally {
		args.store.setStreaming(false);
		args.store.setController(null);
		// The turn is DONE building on the client — move the live draft into the
		// committed log in one atomic store update. No server fetch, no draft→
		// history swap: while the user is on the page there is exactly one copy of
		// each turn (the live one), so the turn can never blink out. Server history
		// is authoritative only on the next cold start (refresh), where it seeds
		// the view from scratch.
		args.store.commit();
	}
}

function stopSession(
	store: ChatSessionStore,
	sessionId: string,
	agentClient: AgentClient
) {
	store.abort();
	// Reflect the stop immediately: mark the in-flight assistant draft stopped
	// (so it stops showing "Thinking…") and free the composer, without waiting
	// for the stream to actually unwind. The finally-commit preserves it.
	store.setStreaming(false);
	store.setDraft(
		store
			.getSnapshot()
			.draft.map((message) =>
				message.role === "assistant" && message.status === "streaming"
					? { ...message, status: "stopped" }
					: message
			)
	);
	if (sessionId !== "") {
		agentClient.cancel(sessionId).catch(() => undefined);
	}
}

export function useChat(sessionId: string, agentClient: AgentClient) {
	// The stream + committed/draft live in a module-level per-session store, so
	// navigating away neither aborts the turn nor loses the conversation —
	// remounting resubscribes and the accumulated turns are still here.
	const store = chatSession(sessionId);
	const { committed, draft, streaming } = useSyncExternalStore(
		store.subscribe,
		store.getSnapshot,
		store.getSnapshot
	);
	// Server history seeds the view ONLY on cold start (refresh): before the user
	// has interacted this session (no committed turns, no draft). Once they do,
	// the query freezes at its seed value and committed/draft own everything.
	const seedPhase = committed.length === 0 && draft.length === 0;
	const history = useQuery({
		queryKey: messagesKey(sessionId),
		queryFn: () => agentClient.listMessages(sessionId),
		enabled: sessionId !== "" && seedPhase,
	});
	const seedRows = history.data ?? [];
	// If the seeded history's trailing turn is still streaming server-side,
	// re-attach to its live event stream and refetch on progress + completion —
	// no interval polling, and it settles the instant the turn ends.
	const running = seedPhase && hasRunningTurn(seedRows);
	const observing = useObserveTurn(
		agentClient.observe,
		sessionId,
		running,
		() => {
			history.refetch();
		}
	);

	const messages: ChatMessage[] = [
		...seedRows.map(toChatMessage),
		...committed,
		...draft,
	];

	const send = (text: string, attachments: AttachmentRef[] = []) =>
		sendMessage(text, attachments, { agentClient, sessionId, store });

	const stop = () => stopSession(store, sessionId, agentClient);

	// `streaming` also covers a detached server-side turn observed on cold start
	// (running from the seeded history, observing from the live stream), so the
	// composer stays disabled and Stop stays available after a reload.
	return { messages, streaming: streaming || running || observing, send, stop };
}
