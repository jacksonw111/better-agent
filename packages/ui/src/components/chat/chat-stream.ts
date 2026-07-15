import {
	createStreamReveal,
	type StreamReveal,
} from "@better-agent/ui/lib/stream-reveal";
import type { AgentClient, RunEvent } from "@jacksonw111/agent-client";

import type { ChatMessage } from "./chat-blocks";

interface StreamState {
	assistant: ChatMessage;
	reveal: StreamReveal | null;
	revealKind: "text" | "reasoning" | null;
	setDraft: (msgs: ChatMessage[]) => void;
	user: ChatMessage;
}

function emit(state: StreamState) {
	state.setDraft([
		state.user,
		{ ...state.assistant, blocks: [...state.assistant.blocks] },
	]);
}

// Finalize the current text/reasoning run: reveal the rest and stop revealing.
function sealReveal(state: StreamState) {
	if (state.reveal) {
		state.reveal.flush();
		state.reveal = null;
		state.revealKind = null;
	}
}

function pushDelta(
	state: StreamState,
	kind: "text" | "reasoning",
	delta: string
) {
	if (state.revealKind !== kind) {
		sealReveal(state);
		state.assistant.blocks.push({ kind, text: "" });
		state.revealKind = kind;
		state.reveal = createStreamReveal({
			onFrame: ({ text, reasoning }) => {
				const last = state.assistant.blocks.at(-1);
				if (last && last.kind === kind) {
					last.text = kind === "text" ? text : reasoning;
				}
				emit(state);
			},
		});
	}
	if (kind === "text") {
		state.reveal?.pushText(delta);
	} else {
		state.reveal?.pushReasoning(delta);
	}
}

function applyToolResult(
	state: StreamState,
	event: Extract<RunEvent, { type: "tool-result" }>
) {
	state.assistant.blocks = state.assistant.blocks.map((block) =>
		block.kind === "tool" && block.tool.callId === event.callId
			? {
					kind: "tool",
					tool: {
						...block.tool,
						result: event.result,
						isError: event.isError,
						status: event.isError ? "error" : "complete",
					},
				}
			: block
	);
	emit(state);
}

function applyEvent(event: RunEvent, state: StreamState) {
	if (event.type === "text-delta") {
		pushDelta(state, "text", event.delta);
	} else if (event.type === "reasoning-delta") {
		pushDelta(state, "reasoning", event.delta);
	} else if (event.type === "tool-call") {
		sealReveal(state);
		state.assistant.blocks.push({
			kind: "tool",
			tool: {
				callId: event.callId,
				toolName: event.toolName,
				args: event.args,
				isError: false,
				status: "running",
			},
		});
		emit(state);
	} else if (event.type === "tool-result") {
		applyToolResult(state, event);
	} else if (event.type === "error") {
		state.assistant.status = "error";
		state.assistant.errorText = event.message;
		emit(state);
	}
}

interface StreamArgs {
	agentClient: AgentClient;
	assistant: ChatMessage;
	attachmentIds?: string[];
	sessionId: string;
	setDraft: (msgs: ChatMessage[]) => void;
	signal: AbortSignal;
	text: string;
	user: ChatMessage;
}

export async function streamPrompt(args: StreamArgs) {
	const state: StreamState = {
		assistant: args.assistant,
		user: args.user,
		setDraft: args.setDraft,
		reveal: null,
		revealKind: null,
	};
	try {
		for await (const event of args.agentClient.stream(args.text, {
			sessionId: args.sessionId,
			signal: args.signal,
			attachmentIds: args.attachmentIds,
		})) {
			// Stop applying events the moment the user aborts, so a stream that
			// doesn't unwind instantly can't keep re-rendering "Thinking…".
			if (args.signal.aborted) {
				break;
			}
			applyEvent(event, state);
		}
		sealReveal(state);
		// A stream that ended without an error event or a user stop IS the
		// completed turn — flip it out of `streaming` so completion-gated UI
		// (the copy / save-as-image actions row) can appear. Stops keep
		// "stopped" (guarded by aborted) and stream errors keep "error".
		if (!args.signal.aborted && state.assistant.status === "streaming") {
			state.assistant.status = "complete";
			state.assistant.live = false;
			emit(state);
		}
	} catch (error) {
		state.reveal?.stop();
		throw error;
	}
}
