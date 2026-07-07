import type { ChatMessage } from "./chat-blocks";

interface ChatSessionState {
	/** Turns completed THIS session, accumulated client-side. The live draft is
	 * moved here on completion — we never re-fetch the server's copy mid-session
	 * (server history seeds the view once, on mount/refresh only). */
	committed: ChatMessage[];
	draft: ChatMessage[];
	streaming: boolean;
}

export interface ChatSessionStore {
	/** Abort the in-flight stream (stop button / explicit cancel only). */
	abort(): void;
	/** Move the current draft into `committed` and clear it — one atomic update,
	 * so the completed turn never blinks out during a draft→history handoff. */
	commit(): void;
	getSnapshot(): ChatSessionState;
	setController(controller: AbortController | null): void;
	setDraft(draft: ChatMessage[]): void;
	setStreaming(streaming: boolean): void;
	subscribe(listener: () => void): () => void;
}

function createChatSessionStore(): ChatSessionStore {
	let state: ChatSessionState = {
		committed: [],
		draft: [],
		streaming: false,
	};
	let controller: AbortController | null = null;
	const listeners = new Set<() => void>();
	const notify = () => {
		for (const listener of listeners) {
			listener();
		}
	};
	return {
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		getSnapshot: () => state,
		setDraft(draft) {
			state = { ...state, draft };
			notify();
		},
		setStreaming(streaming) {
			state = { ...state, streaming };
			notify();
		},
		commit() {
			if (state.draft.length === 0) {
				return;
			}
			state = {
				...state,
				committed: [...state.committed, ...state.draft],
				draft: [],
			};
			notify();
		},
		setController(next) {
			controller = next;
		},
		abort() {
			controller?.abort();
			controller = null;
		},
	};
}

// Streams OUTLIVE the chat screen: state lives here (module scope), keyed by
// session, so navigating away neither aborts the stream nor loses the draft —
// remounting resubscribes and the output keeps flowing. Only the stop button
// (or a server cancel) ends a turn early.
const stores = new Map<string, ChatSessionStore>();

export function chatSession(sessionId: string): ChatSessionStore {
	let store = stores.get(sessionId);
	if (!store) {
		store = createChatSessionStore();
		stores.set(sessionId, store);
	}
	return store;
}
