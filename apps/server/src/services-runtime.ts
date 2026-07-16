import type { CancellationRegistry } from "@better-agent/agent/session/cancellation";
import { createModelSummarizer } from "@better-agent/agent/session/model-summarizer";
import { createModelTitler } from "@better-agent/agent/session/model-titler";
import { createSessionRuntime } from "@better-agent/agent/session/runtime";
import type { createMemoryItemStore } from "@better-agent/db/repositories/memory-item-store";
import type { createMemoryStore } from "@better-agent/db/repositories/memory-store";
import type { createMessageStore } from "@better-agent/db/repositories/message-store";
import type { createSessionStore } from "@better-agent/db/repositories/session-store";
import type { createSkillStore } from "@better-agent/db/repositories/skill-store";
import type { createUsageRecordStore } from "@better-agent/db/repositories/usage-record-store";
import type { createAttachmentStore } from "./attachment-store";
import type { buildEmbeddingClient } from "./embedding-client";
import { type buildProviderDeps, buildSessionLock } from "./services-infra";

// The SessionRuntime assembly, split out of services.ts for the same reason
// as services-infra.ts: keeps that file under the repo's 300-line cap.
export function buildRuntime(parts: {
	attachmentStore: ReturnType<typeof createAttachmentStore>;
	cancellation: CancellationRegistry;
	deps: ReturnType<typeof buildProviderDeps>;
	embeddingClient: ReturnType<typeof buildEmbeddingClient>;
	memoryItemStore: ReturnType<typeof createMemoryItemStore>;
	memoryStore: ReturnType<typeof createMemoryStore>;
	messageStore: ReturnType<typeof createMessageStore>;
	sessionStore: ReturnType<typeof createSessionStore>;
	skillStore: ReturnType<typeof createSkillStore>;
	usageRecordStore: ReturnType<typeof createUsageRecordStore>;
}) {
	const { deps } = parts;
	return createSessionRuntime({
		sessionStore: parts.sessionStore,
		messageStore: parts.messageStore,
		attachmentStore: parts.attachmentStore,
		agentStore: deps.agentStore,
		modelFactory: deps.modelFactory,
		sessionLock: buildSessionLock(),
		modelCacheStore: deps.modelCache,
		providerCatalogStore: deps.providerCatalog,
		summarizer: createModelSummarizer(deps.modelFactory),
		titler: createModelTitler(deps.modelFactory),
		cancellation: parts.cancellation,
		usageRecordStore: parts.usageRecordStore,
		// B1 retrieval injection (see packages/agent/src/session/memory-retrieval.ts):
		// each turn kNN-searches the agent's assigned memories against the latest
		// user message and injects the top-k into the system prompt.
		memoryStore: parts.memoryStore,
		memoryItemStore: parts.memoryItemStore,
		embeddingClient: parts.embeddingClient,
		// Skills T3 injection (see packages/agent/src/session/skill-context.ts):
		// each turn injects the agent's skill index + any activated skill's full
		// instructions into the system prompt.
		skillStore: parts.skillStore,
	});
}
