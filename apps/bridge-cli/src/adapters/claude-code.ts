import {
	type CanUseTool,
	type PermissionMode,
	type PermissionResult,
	query,
	type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { normalizeClaudeCode } from "../normalize/claude-code";
import type { ApprovalOption, NormalizedEvent } from "../normalize/types";
import { isRecord, userMessageEvent } from "../normalize/types";
import { type AsyncQueue, createAsyncQueue } from "./async-queue";
import {
	type LastKnownSessionInfo,
	makeClaudeGetStatus,
	makeListSessions,
	recordSessionInfo,
} from "./claude-code-status";
import { findOnPath } from "./process-io";
import type { Adapter, AgentHandle, StartOptions } from "./types";

// Drives the LOCAL claude via the official Claude Agent SDK rather than
// hand-spawning `claude -p` and reverse-engineering its stream-json stdin
// protocol (which needs an undocumented `initialize` control handshake — the
// reason a hand-rolled process produced nothing). `query()` takes a streaming
// AsyncIterable of user turns, manages the claude subprocess + handshake, and
// yields SDK messages whose shapes match the CLI stream-json we already
// normalize. Tool permission requests route through `canUseTool` back to the
// web approval UI.

const APPROVAL_OPTIONS: ApprovalOption[] = [
	{ id: "allow", label: "Allow" },
	{ id: "deny", label: "Deny" },
];

/** The SDK's full `PermissionMode` enum — narrows a wire string (from the
 * web's `control: setPermissionMode` command) before handing it to
 * `session.setPermissionMode`, instead of an unchecked type assertion. */
const PERMISSION_MODES = new Set<string>([
	"default",
	"acceptEdits",
	"bypassPermissions",
	"plan",
	"dontAsk",
	"auto",
]);

function isPermissionMode(value: string): value is PermissionMode {
	return PERMISSION_MODES.has(value);
}

/** How long to wait for the SDK's `supportedModels()` — resolved off the same
 * init handshake that yields the `session_ready` line — before emitting
 * `session_ready` without a model list. A safety valve so a stuck control
 * channel can never freeze the feed at its very first event; in practice the
 * list is already resolved by the time the init line is normalized. */
const SUPPORTED_MODELS_TIMEOUT_MS = 4000;

type ClaudeQuery = ReturnType<typeof query>;

/** Fetches this session's available model ids from the SDK control channel,
 * resolving to `undefined` (never rejecting, never hanging) on any failure or
 * timeout — see SUPPORTED_MODELS_TIMEOUT_MS. The web model picker lists exactly
 * these ids; an empty/absent list hides the picker. */
function fetchSupportedModels(
	session: ClaudeQuery
): Promise<string[] | undefined> {
	let timer: ReturnType<typeof setTimeout>;
	const timeout = new Promise<undefined>((resolve) => {
		timer = setTimeout(() => resolve(undefined), SUPPORTED_MODELS_TIMEOUT_MS);
	});
	const models = session
		.supportedModels()
		.then((infos) => infos.map((info) => info.value))
		.catch(() => undefined)
		.finally(() => clearTimeout(timer));
	return Promise.race([models, timeout]);
}

/** Folds the agent's reported model ids into the one-time `session_ready`
 * event, leaving every other event untouched. The list comes from the SDK
 * (`supportedModels()`), not the raw init line `normalize/claude-code.ts` sees,
 * so it's merged here in the adapter rather than in normalize. */
async function withReportedModels(
	event: NormalizedEvent,
	models: Promise<string[] | undefined>
): Promise<NormalizedEvent> {
	if (event.kind !== "status" || event.status !== "session_ready") {
		return event;
	}
	const list = await models;
	if (list === undefined || list.length === 0 || !isRecord(event.detail)) {
		return event;
	}
	return {
		kind: "status",
		status: "session_ready",
		detail: { ...event.detail, models: list },
	};
}

function safeJson(value: unknown): string {
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function userTurn(text: string): SDKUserMessage {
	return {
		type: "user",
		message: { role: "user", content: text },
		parent_tool_use_id: null,
	};
}

interface EventSink {
	push(event: NormalizedEvent): void;
}
type ApprovalMap = Map<string, (allow: boolean) => void>;

// Turns each SDK tool-permission request into an approval event and blocks on
// the user's web decision (resolved via the handle's answerApproval).
function makeCanUseTool(events: EventSink, approvals: ApprovalMap): CanUseTool {
	return (toolName, toolInput, options) => {
		const requestId = options.toolUseID;
		events.push({
			kind: "approval",
			requestId,
			title: `Use ${toolName}?`,
			detail: safeJson(toolInput),
			options: APPROVAL_OPTIONS,
		});
		return new Promise<PermissionResult>((resolve) => {
			approvals.set(requestId, (allow) => {
				approvals.delete(requestId);
				resolve(
					allow
						? { behavior: "allow", updatedInput: toolInput }
						: { behavior: "deny", message: "Denied from the bridge." }
				);
			});
		});
	};
}

async function drainSession(
	session: AsyncIterable<unknown>,
	events: AsyncQueue<NormalizedEvent>,
	models: Promise<string[] | undefined>,
	lastKnown: LastKnownSessionInfo
): Promise<void> {
	try {
		for await (const message of session) {
			for (const event of normalizeClaudeCode(message)) {
				// Seed the getStatus snapshot's model/permissionMode off the one-time
				// init event as it flows by (see claude-code-status.ts).
				recordSessionInfo(event, lastKnown);
				events.push(await withReportedModels(event, models));
			}
		}
	} catch (error) {
		events.push({
			kind: "error",
			message: error instanceof Error ? error.message : String(error),
		});
	}
	events.close();
}

/** Builds the SDK `systemPrompt` option: preset+append keeps claude's default
 * prompt and appends the user's instructions (a bare string would REPLACE it). */
function claudeSystemPromptOption(
	config: { appendSystemPrompt?: string } | undefined
) {
	return config?.appendSystemPrompt
		? {
				append: config.appendSystemPrompt,
				preset: "claude_code" as const,
				type: "preset" as const,
			}
		: undefined;
}

/** Starts the SDK `query()` session: the claude subprocess + handshake, wired
 * to this handle's input queue, tool-approval routing, and persisted startup
 * config from the bridge token. */
function startClaudeQuery(
	dir: string,
	opts: StartOptions | undefined,
	input: AsyncQueue<SDKUserMessage>,
	events: EventSink,
	approvals: ApprovalMap
): ClaudeQuery {
	return query({
		prompt: input,
		options: {
			cwd: dir,
			pathToClaudeCodeExecutable: findOnPath("claude"), // user's PATH claude (standalone binary omits the SDK's bundled one)
			// A prior `--resume` claude session id (undefined starts fresh).
			resume: opts?.resume,
			canUseTool: makeCanUseTool(events, approvals),
			// Phase 4: apply persisted startup config from the bridge token.
			systemPrompt: claudeSystemPromptOption(opts?.config),
			maxTurns: opts?.config?.maxTurns,
			maxBudgetUsd: opts?.config?.maxBudgetUsd,
			effort: opts?.config?.effort,
			// Extended thinking's reasoning text only streams as `thinking_delta`
			// frames under includePartialMessages — which also streams the
			// response text as `text_delta` frames, duplicating what later
			// arrives (again) as a text block on the final assistant message.
			// `normalizeClaudeCode` is the dedup point: it treats the streamed
			// deltas as the source of truth and drops the final assistant
			// message's text blocks (keeping its tool_use blocks).
			includePartialMessages: true,
			thinking: { type: "adaptive" },
		},
	});
}

/** Assembles the returned `AgentHandle` — the session's public surface —
 * once `startClaudeQuery` + `drainSession` are wired up. */
function buildClaudeHandle(
	dir: string,
	session: ClaudeQuery,
	input: AsyncQueue<SDKUserMessage>,
	events: AsyncQueue<NormalizedEvent>,
	approvals: ApprovalMap,
	lastKnown: LastKnownSessionInfo
): AgentHandle {
	return {
		events,
		getStatus: makeClaudeGetStatus(session, events, lastKnown),
		answerApproval(requestId: string, optionId: string): void {
			approvals.get(requestId)?.(optionId === "allow");
		},
		// Cancels the in-flight turn only — unlike `stop`, the input/events
		// queues stay open so the user can keep chatting in the same session.
		interrupt(): void {
			session.interrupt().catch(() => undefined);
		},
		listSessions: makeListSessions(dir, events),
		send(text: string): void {
			// Persist the user's own turn (see userMessageEvent) so it survives
			// a page reload, THEN forward it to the agent.
			events.push(userMessageEvent(text));
			input.push(userTurn(text));
		},
		setModel(model: string): void {
			lastKnown.model = model;
			session.setModel(model).catch(() => undefined);
		},
		setPermissionMode(mode: string): void {
			if (isPermissionMode(mode)) {
				lastKnown.permissionMode = mode;
				session.setPermissionMode(mode).catch(() => undefined);
			}
		},
		stop(): void {
			input.close();
			session.interrupt().catch(() => undefined);
			events.close();
		},
	};
}

export const claudeCodeAdapter: Adapter = {
	// biome-ignore lint/suspicious/useAwait: the Adapter interface returns a Promise; the SDK query starts lazily.
	async start(dir: string, opts?: StartOptions): Promise<AgentHandle> {
		const events = createAsyncQueue<NormalizedEvent>();
		const input = createAsyncQueue<SDKUserMessage>();
		// requestId → resolver that completes the pending canUseTool promise.
		const approvals: ApprovalMap = new Map();

		const session = startClaudeQuery(dir, opts, input, events, approvals);
		// Kicked off immediately: `supportedModels()` resolves off the same init
		// handshake that produces the `session_ready` line, so it's ready by the
		// time `withReportedModels` merges it in (see fetchSupportedModels).
		const models = fetchSupportedModels(session);
		// getStatus's model/permissionMode source: the SDK has no on-demand read
		// for the permission mode, so the adapter tracks the last-known values
		// (init event + this handle's own setModel/setPermissionMode calls).
		const lastKnown: LastKnownSessionInfo = {};
		drainSession(session, events, models, lastKnown);

		return buildClaudeHandle(dir, session, input, events, approvals, lastKnown);
	},
};
