import type { SharedV3ProviderOptions } from "@ai-sdk/provider";
import type { ModelMessage } from "ai";
import { stepCountIs, streamText } from "ai";
import type { AgentConfig, AgentParams } from "../agent/types";
import type {
	AgentStore,
	AttachmentStore,
	EmbeddingClient,
	MemoryItemStore,
	MemoryStore,
	MessageStore,
	ModelCacheStore,
	ProviderCatalogStore,
	SessionStore,
	SkillStore,
	UsageRecordStore,
} from "../ports";
import { applyCachePolicy, resolveCachePolicy } from "../provider/cache-policy";
import type { ModelFactory } from "../provider/model-factory";
import { buildTools } from "../tool/registry";
import { buildDeferredBinding, shouldDefer } from "../tool/tool-search";
import type { ToolDef } from "../tool/types";
import type { CancellationRegistry } from "./cancellation";
import type { Summarizer } from "./compaction";
import { createDoomLoopGuard, type DoomLoopGuard } from "./doom-loop";
import { classifyError } from "./error-classify";
import type { RunEvent } from "./events";
import { buildSettings } from "./model-settings";
import { createPartBuffer } from "./part-buffer";
import type { StreamOutcome } from "./retry-helpers";
import {
	backoffMs,
	defaultSleep,
	MAX_LLM_ATTEMPTS,
	resetOutcome,
	shouldRetryAttempt,
} from "./retry-helpers";
import type { DrainCtx } from "./runtime-drain";
import { drainStream } from "./runtime-drain";
import { finalizeAssistant } from "./runtime-finalize";
import { buildAssistantCtx, settleTitleEvent } from "./runtime-support";
import { SessionBusyError, type SessionLock } from "./session-lock";
import type { Titler } from "./titler";
import { maybeTitle } from "./titler";
import {
	buildTurnMessages,
	loadContext,
	persistUserTurn,
} from "./turn-messages";
import type { Message, PartStatus, Session } from "./types";

const DEFAULT_MAX_STEPS = 50;

export interface SessionRuntimeDeps {
	agentStore: AgentStore;
	attachmentStore?: AttachmentStore;
	cancellation?: CancellationRegistry;
	clock?: () => Date;
	/** B1 memory-retrieval injection (see turn-messages.ts / memory-retrieval.ts).
	 * All three optional — omitted in most existing runtime tests, which don't
	 * exercise memory; retrieval is a no-op without them. */
	embeddingClient?: EmbeddingClient | null;
	memoryItemStore?: MemoryItemStore;
	memoryStore?: MemoryStore;
	messageStore: MessageStore;
	modelCacheStore: ModelCacheStore;
	modelFactory: ModelFactory;
	providerCatalogStore: ProviderCatalogStore;
	sessionLock: SessionLock;
	sessionStore: SessionStore;
	skillStore?: SkillStore;
	sleep?: (ms: number) => Promise<void>;
	summarizer: Summarizer;
	titler?: Titler;
	/** Dual-write target for `usage_records` (Task 3). Optional like the other
	 * infra deps above — omitted in most existing runtime tests, which don't
	 * exercise usage accounting. */
	usageRecordStore?: UsageRecordStore;
}

export interface RunTurnInput {
	abortSignal?: AbortSignal;
	/** Ids of attachments uploaded for this turn (linked to the user message). */
	attachmentIds?: string[];
	sessionId: string;
	text: string;
	tools?: ToolDef[];
}

export interface SessionRuntime {
	runTurn(input: RunTurnInput): AsyncGenerator<RunEvent, Message>;
}

type AiModel = Awaited<ReturnType<ModelFactory["create"]>>;

interface AttemptArgs {
	abortSignal?: AbortSignal;
	/** Deferred-binding mode: the tool names the model may see this step. */
	activeToolNames?: () => string[];
	cacheToolDefs?: boolean;
	ctx: DrainCtx;
	guard?: DoomLoopGuard;
	messages: ModelMessage[];
	model: AiModel;
	params: AgentParams | null;
	providerOptions: SharedV3ProviderOptions;
}

// Deferred binding: inactive schemas aren't sent; search grows the set.
function deferStepOptions(args: AttemptArgs) {
	return args.activeToolNames
		? { prepareStep: () => ({ activeTools: args.activeToolNames?.() }) }
		: {};
}

async function* runAttempt(
	args: AttemptArgs,
	bufs: {
		text: ReturnType<typeof createPartBuffer>;
		reasoning: ReturnType<typeof createPartBuffer>;
	},
	state: StreamOutcome
): AsyncGenerator<RunEvent, void> {
	const { model, messages, providerOptions, params, ctx, abortSignal } = args;
	try {
		const tools = buildTools(
			ctx.toolDefs,
			{
				sessionId: ctx.sessionId,
				messageId: ctx.assistantId,
				agentId: ctx.agentId,
				abortSignal: abortSignal ?? new AbortController().signal,
			},
			{ cacheLastToolDef: args.cacheToolDefs === true, guard: args.guard }
		);
		const result = streamText({
			model,
			messages,
			providerOptions,
			stopWhen: stepCountIs(DEFAULT_MAX_STEPS),
			tools,
			...deferStepOptions(args),
			experimental_repairToolCall: () => Promise.resolve(null),
			abortSignal,
			maxRetries: 0,
			...buildSettings(params),
		});
		yield* drainStream(result, bufs, state, ctx);
	} catch (error) {
		if (abortSignal?.aborted) {
			state.status = "aborted";
		} else {
			state.status = "error";
			state.finishReason = "error";
			state.errorMessage =
				error instanceof Error ? error.message : String(error);
			state.errorCategory = classifyError(error);
		}
	}
}

async function* streamAssistant(
	deps: SessionRuntimeDeps,
	args: AttemptArgs
): AsyncGenerator<RunEvent, StreamOutcome> {
	const { ctx, abortSignal } = args;
	const bufs = {
		text: createPartBuffer(deps.messageStore, ctx.assistantId, "text"),
		reasoning: createPartBuffer(
			deps.messageStore,
			ctx.assistantId,
			"reasoning"
		),
	};
	const sleep = deps.sleep ?? defaultSleep;
	const state: StreamOutcome = {
		usage: null,
		finishReason: "stop",
		status: "complete",
		errorMessage: null,
		errorCategory: null,
		emittedOutput: false,
	};
	for (let attempt = 1; attempt <= MAX_LLM_ATTEMPTS; attempt++) {
		resetOutcome(state);
		yield* runAttempt(args, bufs, state);
		if (shouldRetryAttempt(state, attempt, abortSignal?.aborted ?? false)) {
			await sleep(backoffMs(attempt));
			continue;
		}
		break;
	}
	const partStatus: PartStatus =
		state.status === "error" ? "error" : "complete";
	await bufs.reasoning.flush(partStatus);
	await bufs.text.flush(partStatus);
	return state;
}

async function prepareMessages(
	deps: SessionRuntimeDeps,
	agent: AgentConfig,
	session: Session,
	sessionId: string
) {
	const rawMessages = await buildTurnMessages(deps, agent, session, sessionId);
	const provider = await deps.providerCatalogStore.get(agent.providerId);
	const policy = resolveCachePolicy(provider?.npm ?? null);
	return applyCachePolicy({ messages: rawMessages, sessionId }, policy);
}

// Assemble the turn's tool set. Past the defer threshold, defer-marked schemas
// are withheld and reached through search_tools (token cost scales with tools
// USED).
function prepareToolBinding(tools: ToolDef[] | undefined): {
	activeNames?: () => string[];
	defs: ToolDef[];
} {
	const toolDefs = [...(tools ?? [])];
	if (!shouldDefer(toolDefs)) {
		return { defs: toolDefs };
	}
	const binding = buildDeferredBinding(toolDefs);
	return { defs: binding.defs, activeNames: binding.activeNames };
}

async function* executeTurn(
	deps: SessionRuntimeDeps,
	input: RunTurnInput
): AsyncGenerator<RunEvent, Message> {
	const { sessionId, text, abortSignal, tools } = input;
	const { session, agent } = await loadContext(deps, sessionId);
	await persistUserTurn({
		messageStore: deps.messageStore,
		attachmentStore: deps.attachmentStore,
		sessionId,
		text,
		attachmentIds: input.attachmentIds,
	});
	const titlePromise = maybeTitle(deps, session, agent, text);
	const cached = await prepareMessages(deps, agent, session, sessionId);
	const binding = prepareToolBinding(tools);
	const { assistant, ctx } = await buildAssistantCtx(
		deps.messageStore,
		agent,
		sessionId,
		binding.defs
	);
	yield { type: "message-start", messageId: assistant.id };
	const model = await deps.modelFactory.create(agent.providerId, agent.modelId);
	const guard = createDoomLoopGuard();
	const outcome = yield* streamAssistant(deps, {
		model,
		messages: cached.messages,
		providerOptions: cached.providerOptions,
		params: agent.params,
		ctx,
		abortSignal,
		cacheToolDefs: cached.cacheToolDefs,
		guard,
		activeToolNames: binding.activeNames,
	});
	const message = yield* finalizeAssistant(deps, {
		agent,
		assistantId: assistant.id,
		fallback: assistant,
		sessionId,
		outcome,
		userId: session.userId,
	});
	// Settles on done AND error: title derives from the persisted user message.
	yield* settleTitleEvent(deps.sessionStore, sessionId, titlePromise);
	return message;
}

export function createSessionRuntime(deps: SessionRuntimeDeps): SessionRuntime {
	return {
		async *runTurn(input) {
			if (!(await deps.sessionLock.acquire(input.sessionId))) {
				throw new SessionBusyError(input.sessionId);
			}
			const controller = new AbortController();
			const abortSignal = input.abortSignal
				? AbortSignal.any([input.abortSignal, controller.signal])
				: controller.signal;
			deps.cancellation?.register(input.sessionId, controller);
			try {
				return yield* executeTurn(deps, { ...input, abortSignal });
			} finally {
				deps.cancellation?.unregister(input.sessionId);
				await deps.sessionLock.release(input.sessionId);
			}
		},
	};
}
