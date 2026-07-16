import type { RunEvent } from "@better-agent/agent/session/events";
import type {
	Message,
	MessageWithParts,
} from "@better-agent/agent/session/types";

// Re-export the canonical session domain types so the SDK's public surface is
// self-contained — these are the exact shapes the server returns.
export type { RunEvent } from "@better-agent/agent/session/events";
export type {
	Message,
	MessageError,
	MessagePart,
	MessagePartContent,
	MessageRole,
	MessageStatus,
	MessageUsage,
} from "@better-agent/agent/session/types";

/** Final assistant message returned by `run()`. */
export type RunResult = Message;

/** Full session history: each message paired with its ordered parts. */
export type MessageHistory = MessageWithParts[];

/** A locally-executable tool definition for the client SDK. */
export interface ClientToolDef {
	description: string;
	execute(args: unknown): Promise<string>;
	name: string;
	parameters: Record<string, unknown>;
}

export interface AgentClientConfig {
	/** server root, e.g. "http://localhost:3000"; the SDK appends "/rpc". */
	baseURL: string;
	/** agent token (returned when an agent is created). Sent as a Bearer header. */
	token: string;
}

export interface RunOptions {
	/** Ids of attachments (from `uploadAttachment`) to send with this turn. */
	attachmentIds?: string[];
	/** Continue an existing session; omit to auto-create a one-shot session. */
	sessionId?: string;
	/** Abort signal: cancels an in-flight run/stream. */
	signal?: AbortSignal;
	/** Local tool definitions to execute on tool-call events from the server. */
	tools?: ClientToolDef[];
}

/** Metadata for an uploaded attachment, returned by `uploadAttachment`. */
export interface UploadedAttachment {
	id: string;
	mime: string;
	name: string;
	size: number;
}

export interface AgentClient {
	/** Cancel the in-flight turn for a session (server-side cancellation). */
	cancel(sessionId: string): Promise<void>;
	/** Create a new session bound to this client's agent. */
	createSession(): Promise<{ sessionId: string }>;
	/** Fetch an uploaded attachment's bytes (e.g. to render an image). */
	getAttachment(id: string): Promise<Blob>;
	/** Replay a session's full message history with parts. */
	listMessages(sessionId: string): Promise<MessageHistory>;
	/** Re-attach to a session's in-flight turn: replays the running turn's
	 * events then tails live, ending immediately when the turn finishes (or at
	 * once if none is running). Lets a reconnecting client follow a turn without
	 * polling. Optional — only the user-session plane implements it. */
	observe?(sessionId: string): AsyncGenerator<RunEvent>;
	/** Run one turn, returning the final assistant message (auto-creates a session if omitted). */
	run(text: string, options?: RunOptions): Promise<RunResult>;
	/** Run one turn, streaming run events (auto-creates a session if omitted). */
	stream(text: string, options?: RunOptions): AsyncGenerator<RunEvent>;
	/** Upload an image/file for a session; returns its id to pass as an attachmentId. */
	uploadAttachment(sessionId: string, file: File): Promise<UploadedAttachment>;
}
