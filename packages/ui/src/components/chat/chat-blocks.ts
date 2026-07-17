import type { MessageHistory } from "@jacksonw111/agent-client";

type SessionMessageRow = MessageHistory[number];

export interface ToolInvocation {
	args: unknown;
	callId: string;
	/** R1-T2/R1-T3: wall-clock ms the call took (started→completed/failed),
	 * when the adapter measured it. Rendered right-aligned on the local-agent
	 * terminal's ActivityItem header — see `apps/web/src/components/bridge/`. */
	durationMs?: number;
	isError: boolean;
	/** R1-T2/R1-T3: a RUNNING call's latest partial output (replace, not
	 * append) — the local-agent terminal shows its last line as a live tail. */
	preview?: string;
	result?: unknown;
	status: "running" | "complete" | "error";
	/** R1-T2/R1-T3: a short human-readable label distinct from `toolName`,
	 * when the wire carries one. */
	title?: string;
	toolName: string;
}

export interface AttachmentRef {
	attachmentId: string;
	mime: string;
	name: string;
}

/** One selectable option on an embedded approval request. */
export interface ApprovalOption {
	id: string;
	label: string;
}

/** A pending permission request embedded inline in an assistant message
 * (the bridge terminal's approval/ExitPlanMode flow). Carries everything the
 * renderer needs without depending on the bridge's wire-event types — the
 * bridge maps its `ApprovalEvent` onto this shape when it folds the request
 * into the turn as a block (see bridge-assistant-merge.ts). */
export interface ApprovalBlockData {
	detail?: string;
	options: ApprovalOption[];
	requestId: string;
	summary?: string;
	timeoutAt?: number;
	timeoutMs?: number;
	title: string;
}

/** One question within an embedded question request. */
export interface QuestionBlockItem {
	options: string[];
	text: string;
}

/** A pending question request embedded inline in an assistant message
 * (opencode's `question.asked`). Mirrors `ApprovalBlockData`'s decoupling. */
export interface QuestionBlockData {
	questions: QuestionBlockItem[];
	requestId: string;
	/** fix-question-replay: mirrors `ApprovalBlockData.timeoutAt` — drives the
	 * question card's countdown bar and its neutral expired notice. */
	timeoutAt?: number;
	timeoutMs?: number;
	title: string;
}

/** One ordered piece of a turn. `file` parts are user-uploaded attachments
 * (e.g. images sent with the message). `approval`/`question` parts are the
 * bridge terminal's embedded request cards (cloud chat never produces them). */
export type ChatBlock =
	| { kind: "text"; text: string }
	| { kind: "reasoning"; text: string }
	| { kind: "tool"; tool: ToolInvocation }
	| { kind: "file"; file: AttachmentRef }
	| { kind: "approval"; approval: ApprovalBlockData }
	| { kind: "question"; question: QuestionBlockData };

export interface ChatMessage {
	blocks: ChatBlock[];
	errorText?: string;
	id: string;
	/** True only for the in-flight draft being streamed right now. Refetched
	 * history messages are never live, so a stale `streaming` status (e.g. a
	 * stopped/orphaned turn) won't show the "Thinking…" shimmer forever. */
	live?: boolean;
	role: "user" | "assistant" | "system";
	status: "complete" | "streaming" | "error" | "stopped";
}

function partStatus(status: SessionMessageRow["message"]["status"]) {
	if (status === "complete") {
		return "complete" as const;
	}
	if (status === "error") {
		return "error" as const;
	}
	if (status === "aborted") {
		return "complete" as const;
	}
	return "streaming" as const;
}

/** Append text to the trailing block if it's the same kind, else start a new one. */
export function appendText(
	blocks: ChatBlock[],
	kind: "text" | "reasoning",
	text: string
) {
	const last = blocks.at(-1);
	if (last && last.kind === kind) {
		last.text += text;
	} else {
		blocks.push({ kind, text });
	}
}

interface BuiltParts {
	blocks: ChatBlock[];
}

interface ToolCallContent {
	args: unknown;
	callId: string;
	toolName: string;
}
interface ToolResultContent {
	callId: string;
	isError: boolean;
	result: unknown;
}

function pushToolCall(
	blocks: ChatBlock[],
	toolByCallId: Map<string, ToolInvocation>,
	content: ToolCallContent
): void {
	const tool: ToolInvocation = {
		callId: content.callId,
		toolName: content.toolName,
		args: content.args,
		isError: false,
		status: "running",
	};
	blocks.push({ kind: "tool", tool });
	toolByCallId.set(content.callId, tool);
}

function applyToolResultPart(
	blocks: ChatBlock[],
	toolByCallId: Map<string, ToolInvocation>,
	content: ToolResultContent
): void {
	const tool = toolByCallId.get(content.callId);
	const status = content.isError ? "error" : "complete";
	if (tool) {
		tool.result = content.result;
		tool.isError = content.isError;
		tool.status = status;
		return;
	}
	// Orphan tool-result: a tool-error with no preceding tool-call part
	// (invalid-args / no-such-tool / unrepairable call — the SDK emits tool-error
	// carrying a callId but no tool-call chunk). Render it as its own block
	// instead of dropping it — a dropped result can leave an otherwise-empty
	// streaming message rendering fully blank.
	const orphan: ToolInvocation = {
		callId: content.callId,
		toolName: "tool",
		args: undefined,
		result: content.result,
		isError: content.isError,
		status,
	};
	blocks.push({ kind: "tool", tool: orphan });
	toolByCallId.set(content.callId, orphan);
}

/** Build the ordered blocks for a persisted message (parts are seq-ordered). */
function buildBlocks(parts: SessionMessageRow["parts"]): BuiltParts {
	const blocks: ChatBlock[] = [];
	const toolByCallId = new Map<string, ToolInvocation>();
	for (const part of parts) {
		if (part.type === "text") {
			appendText(blocks, "text", part.content.text);
		} else if (part.type === "reasoning") {
			appendText(blocks, "reasoning", part.content.text);
		} else if (part.type === "tool-call") {
			pushToolCall(blocks, toolByCallId, part.content);
		} else if (part.type === "tool-result") {
			applyToolResultPart(blocks, toolByCallId, part.content);
		} else if (part.type === "file") {
			blocks.push({
				kind: "file",
				file: {
					attachmentId: part.content.attachmentId,
					mime: part.content.mime,
					name: part.content.name,
				},
			});
		}
	}
	return { blocks };
}

export function toChatMessage(entry: SessionMessageRow): ChatMessage {
	const { blocks } = buildBlocks(entry.parts);
	return {
		id: entry.message.id,
		role: entry.message.role,
		status: partStatus(entry.message.status),
		blocks,
	};
}

/** Concatenate the text blocks of a message (for copy / user display). */
export function messageText(message: ChatMessage): string {
	return message.blocks
		.filter((b): b is { kind: "text"; text: string } => b.kind === "text")
		.map((b) => b.text)
		.join("");
}
