import type { ModelMessage } from "ai";
import type { AgentConfig } from "../agent/types";
import type {
	AgentStore,
	AttachmentStore,
	EmbeddingClient,
	MemoryItemStore,
	MemoryStore,
	MessageStore,
	ModelCacheStore,
	SessionStore,
	SkillStore,
} from "../ports";
import { compactSession, type Summarizer } from "./compaction";
import { buildDynamicContext } from "./dynamic-context";
import { buildMemoryContext, latestUserText } from "./memory-retrieval";
import { buildSkillContext } from "./skill-context";
import { type ResolvedImages, toModelMessages } from "./to-model-messages";
import { estimateTokens, exceedsContext } from "./token-estimate";
import type { MessageWithParts, Session } from "./types";

interface BuildTurnMessagesDeps {
	attachmentStore?: AttachmentStore;
	clock?: () => Date;
	/** B1 retrieval injection (see memory-retrieval.ts). All three are optional
	 * so existing callers/tests that don't wire memory keep working — retrieval
	 * is simply skipped when memoryStore/memoryItemStore are absent. */
	embeddingClient?: EmbeddingClient | null;
	memoryItemStore?: MemoryItemStore;
	memoryStore?: MemoryStore;
	messageStore: MessageStore;
	modelCacheStore: ModelCacheStore;
	sessionStore: SessionStore;
	/** Skills T3 injection (see skill-context.ts). Optional — omitted in most
	 * existing turn-messages tests, which don't exercise skills; the skills
	 * block is simply skipped when absent. */
	skillStore?: SkillStore;
	summarizer: Summarizer;
}

/** Fetch bytes for every image `file` part in the history so the model can see
 * them. Non-image files are skipped (stored + shown, but not sent as content). */
async function resolveImages(
	attachmentStore: AttachmentStore | undefined,
	history: MessageWithParts[]
): Promise<ResolvedImages> {
	const images: ResolvedImages = new Map();
	if (!attachmentStore) {
		return images;
	}
	for (const entry of history) {
		for (const part of entry.parts) {
			if (part.type !== "file" || !part.content.mime.startsWith("image/")) {
				continue;
			}
			const bytes = await attachmentStore.getBytes(part.content.attachmentId);
			if (bytes) {
				images.set(part.content.attachmentId, {
					data: bytes,
					mime: part.content.mime,
				});
			}
		}
	}
	return images;
}

interface LoadContextDeps {
	agentStore: AgentStore;
	sessionStore: SessionStore;
}

export async function loadContext(
	deps: LoadContextDeps,
	sessionId: string
): Promise<{ session: Session; agent: AgentConfig }> {
	const session = await deps.sessionStore.get(sessionId);
	if (!session) {
		throw new Error(`Session ${sessionId} not found`);
	}
	const agent = await deps.agentStore.get(session.agentId);
	if (!agent) {
		throw new Error(`Agent ${session.agentId} not found`);
	}
	return { session, agent };
}

async function appendFileParts(
	messageStore: MessageStore,
	attachmentStore: AttachmentStore,
	messageId: string,
	attachmentIds: string[]
): Promise<void> {
	await attachmentStore.linkToMessage(attachmentIds, messageId);
	for (const id of attachmentIds) {
		const att = await attachmentStore.getById(id);
		if (att) {
			await messageStore.appendPart({
				messageId,
				type: "file",
				content: { attachmentId: att.id, mime: att.mime, name: att.name },
				status: "complete",
			});
		}
	}
}

export async function persistUserTurn(input: {
	attachmentIds?: string[];
	attachmentStore?: AttachmentStore;
	messageStore: MessageStore;
	sessionId: string;
	text: string;
}): Promise<void> {
	const { messageStore, attachmentStore, sessionId, text, attachmentIds } =
		input;
	const msg = await messageStore.createMessage({
		sessionId,
		role: "user",
		status: "complete",
		providerId: null,
		modelId: null,
	});
	if (text.length > 0) {
		await messageStore.appendPart({
			messageId: msg.id,
			type: "text",
			content: { text },
			status: "complete",
		});
	}
	if (attachmentStore && attachmentIds && attachmentIds.length > 0) {
		await appendFileParts(messageStore, attachmentStore, msg.id, attachmentIds);
	}
}

// Skills T3 injection: appends the agent's skill index (+ any activated
// skill's full instructions, see skill-context.ts) right after the dynamic
// context. A no-op whenever skillStore isn't wired for this deps object or
// the agent has no assigned skills.
async function resolveSkillPrompt(
	deps: BuildTurnMessagesDeps,
	agentId: string,
	history: MessageWithParts[]
): Promise<string | null> {
	if (!deps.skillStore) {
		return null;
	}
	return await buildSkillContext(deps.skillStore, agentId, history);
}

// B1 retrieval injection: appends a compact block of the agent's assigned
// memories most relevant to the current turn. A no-op (returns null) whenever
// memory isn't wired for this deps object, the agent has no assigned
// memories, or retrieval fails — see buildMemoryContext's own guards/try-catch.
async function resolveMemoryPrompt(
	deps: BuildTurnMessagesDeps,
	agentId: string,
	history: MessageWithParts[]
): Promise<string | null> {
	if (!(deps.memoryStore && deps.memoryItemStore)) {
		return null;
	}
	return await buildMemoryContext(
		{
			memoryStore: deps.memoryStore,
			memoryItemStore: deps.memoryItemStore,
			embeddingClient: deps.embeddingClient,
		},
		agentId,
		latestUserText(history)
	);
}

/** Composes the full system prompt: base (systemPrompt + dynamic context),
 * then the skills block, then the memory block — each appended only when
 * non-null. All three blocks end up in ONE leading system message
 * (to-model-messages.ts), so they ride a single Anthropic cacheControl
 * breakpoint (provider/cache-policy.ts) rather than needing their own. */
async function resolveSystemPrompt(
	deps: BuildTurnMessagesDeps,
	agent: AgentConfig,
	history: MessageWithParts[],
	now: Date
): Promise<string> {
	const base = `${agent.systemPrompt}\n\n${buildDynamicContext(now)}`;
	const blocks = await Promise.all([
		resolveSkillPrompt(deps, agent.id, history),
		resolveMemoryPrompt(deps, agent.id, history),
	]);
	return [
		base,
		...blocks.filter((block): block is string => block !== null),
	].join("\n\n");
}

export async function buildTurnMessages(
	deps: BuildTurnMessagesDeps,
	agent: AgentConfig,
	session: Session,
	sessionId: string
): Promise<ModelMessage[]> {
	const history = await deps.messageStore.listWithParts(sessionId);
	const now = (deps.clock ?? (() => new Date()))();
	const systemPrompt = await resolveSystemPrompt(deps, agent, history, now);
	const images = await resolveImages(deps.attachmentStore, history);
	const base = {
		systemPrompt,
		summary: session.summary,
		compactedThroughSeq: session.compactedThroughSeq,
		history,
		images,
	};
	const messages = toModelMessages(base);
	const modelEntry = await deps.modelCacheStore.get(
		agent.providerId,
		agent.modelId
	);
	const limit = modelEntry?.contextLimit ?? null;
	if (!exceedsContext(estimateTokens(messages), limit)) {
		return messages;
	}
	const compacted = await compactSession(
		{ summarizer: deps.summarizer, sessionStore: deps.sessionStore },
		{ sessionId, agent, session, history }
	);
	if (compacted === null) {
		return messages;
	}
	return toModelMessages({
		...base,
		summary: compacted.summary,
		compactedThroughSeq: compacted.boundary,
	});
}
