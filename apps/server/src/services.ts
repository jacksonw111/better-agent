import { createTokenService } from "@better-agent/agent/crypto/agent-token";
import { createGithubClient } from "@better-agent/agent/github/github-client";
import { createModelCatalog } from "@better-agent/agent/provider/model-catalog";
import { fetchModelsDev } from "@better-agent/agent/provider/models-dev";
import type { CancellationRegistry } from "@better-agent/agent/session/cancellation";
import { createActivityStore } from "@better-agent/db/repositories/activity-store";
import { createAttachmentMetaStore } from "@better-agent/db/repositories/attachment-meta-store";
import { createComposioAccountStore } from "@better-agent/db/repositories/composio-account-store";
import { createGithubConnectionStore } from "@better-agent/db/repositories/github-connection-store";
import { createKnowledgeDocumentStore } from "@better-agent/db/repositories/knowledge-document-store";
import { createMcpServerStore } from "@better-agent/db/repositories/mcp-server-store";
import { createMemoryItemStore } from "@better-agent/db/repositories/memory-item-store";
import { createMemoryStore } from "@better-agent/db/repositories/memory-store";
import { createMessageStore } from "@better-agent/db/repositories/message-store";
import { createOpenConnectorAccountStore } from "@better-agent/db/repositories/openconnector-account-store";
import { createSessionStore } from "@better-agent/db/repositories/session-store";
import { createSettingsStore } from "@better-agent/db/repositories/settings-store";
import { createSkillStore } from "@better-agent/db/repositories/skill-store";
import { createUsageRecordStore } from "@better-agent/db/repositories/usage-record-store";
import { createUsageStore } from "@better-agent/db/repositories/usage-store";
import { createWebAuthzCacheStore } from "@better-agent/db/repositories/web-authz-cache-store";
import { env } from "@better-agent/env/server";
import { createAttachmentStore } from "./attachment-store";
import { buildAuthServices } from "./auth-services";
import { buildAuthzClient } from "./authz-client";
import { buildEmbeddingClient } from "./embedding-client";
import { createKnowledgeStore, type MultipartBucket } from "./knowledge-store";
import { buildMcpResolver } from "./mcp";
import {
	buildComposioAccountResolver,
	buildGoogleOAuth,
	buildOpenConnectorAccountResolver,
} from "./optional-services";
import {
	buildCancellation,
	buildPendingToolCallStore,
	buildProviderDeps,
	buildRateLimiter,
	type Db,
	getSecretBox,
} from "./services-infra";
import { buildRuntime } from "./services-runtime";

// Shared by buildStores + assembleServices (both take "everything needed to
// construct a store"); factored out so neither signature repeats the list.
interface StoreParts {
	activityStore: ReturnType<typeof createActivityStore>;
	attachmentStore: ReturnType<typeof createAttachmentStore>;
	composioAccount: ReturnType<typeof createComposioAccountStore>;
	db: Db;
	deps: ReturnType<typeof buildProviderDeps>;
	embeddingClient: ReturnType<typeof buildEmbeddingClient>;
	githubConnectionStore: ReturnType<typeof createGithubConnectionStore>;
	knowledgeStore: ReturnType<typeof createKnowledgeStore>;
	mcpServerStore: ReturnType<typeof createMcpServerStore>;
	memoryItemStore: ReturnType<typeof createMemoryItemStore>;
	memoryStore: ReturnType<typeof createMemoryStore>;
	messageStore: ReturnType<typeof createMessageStore>;
	openConnectorAccount: ReturnType<typeof createOpenConnectorAccountStore>;
	secretBox: ReturnType<typeof getSecretBox>;
	sessionStore: ReturnType<typeof createSessionStore>;
	settings: ReturnType<typeof createSettingsStore>;
	skillStore: ReturnType<typeof createSkillStore>;
	usageRecordStore: ReturnType<typeof createUsageRecordStore>;
	usageStore: ReturnType<typeof createUsageStore>;
	webAuthzCache: ReturnType<typeof createWebAuthzCacheStore>;
}

function buildStores(
	parts: StoreParts & {
		authStores: ReturnType<typeof buildAuthServices>["authStores"];
	}
) {
	const { deps, authStores } = parts;
	return {
		providerCatalog: deps.providerCatalog,
		modelCache: deps.modelCache,
		providerCredential: deps.providerCredential,
		agent: deps.agentStore,
		session: parts.sessionStore,
		message: parts.messageStore,
		attachment: parts.attachmentStore,
		settings: parts.settings,
		composioAccount: parts.composioAccount,
		openConnectorAccount: parts.openConnectorAccount,
		mcpServer: parts.mcpServerStore,
		usage: parts.usageStore,
		usageRecord: parts.usageRecordStore,
		activity: parts.activityStore,
		webAuthzCache: parts.webAuthzCache,
		githubConnection: parts.githubConnectionStore,
		knowledge: parts.knowledgeStore,
		memory: parts.memoryStore,
		memoryItem: parts.memoryItemStore,
		skill: parts.skillStore,
		...authStores,
	};
}

function assembleServices(
	parts: StoreParts & {
		auth: ReturnType<typeof buildAuthServices>;
		cancellation: CancellationRegistry;
		runtime: ReturnType<typeof buildRuntime>;
	}
) {
	const { deps, auth } = parts;
	return {
		catalog: createModelCatalog({
			catalogStore: deps.providerCatalog,
			modelStore: deps.modelCache,
			fetcher: () => fetchModelsDev(env.MODELS_DEV_URL),
			allowedProviders: env.CATALOG_PROVIDERS,
		}),
		modelFactory: deps.modelFactory,
		agentValidator: deps.agentValidator,
		runtime: parts.runtime,
		tokenService: createTokenService(),
		jwtService: auth.jwtService,
		emailSender: auth.emailSender,
		authConfig: auth.authConfig,
		cancellation: parts.cancellation,
		pendingToolCallStore: buildPendingToolCallStore(),
		googleOAuth: buildGoogleOAuth(),
		composio: buildComposioAccountResolver(parts.composioAccount),
		openConnector: buildOpenConnectorAccountResolver(
			parts.openConnectorAccount
		),
		embeddingClient: parts.embeddingClient,
		// S4-T1 (D7): real fetch-based GitHub client, one instance per decrypted
		// PAT. Routers decrypt via secretBox right before calling this — the
		// token never rests anywhere but as secret-box ciphertext.
		githubClient: (token: string) => createGithubClient({ token }),
		secretBox: parts.secretBox,
		mcp: buildMcpResolver(parts.mcpServerStore),
		authz: buildAuthzClient(),
		rateLimiter: buildRateLimiter(),
		stores: buildStores({ ...parts, authStores: auth.authStores }),
	};
}

// The "one-off, no cross-dependency" stores assembleServices needs — split out
// so buildServices stays under the repo's max-lines-per-function gate.
function buildMiscStores(db: Db, secretBox: ReturnType<typeof getSecretBox>) {
	return {
		usageStore: createUsageStore(db),
		usageRecordStore: createUsageRecordStore(db),
		activityStore: createActivityStore(db),
		auth: buildAuthServices(db),
		settings: createSettingsStore(db, secretBox),
		composioAccount: createComposioAccountStore(db, secretBox),
		openConnectorAccount: createOpenConnectorAccountStore(db, secretBox),
		mcpServerStore: createMcpServerStore(db, secretBox),
		webAuthzCache: createWebAuthzCacheStore(db),
		githubConnectionStore: createGithubConnectionStore(db),
		secretBox,
	};
}

// Uploads-backed stores (attachment blobs + knowledge documents) share the
// same multipart bucket; split out to keep buildServices under the line gate.
function buildUploadStores(db: Db, uploads?: MultipartBucket) {
	return {
		attachmentStore: createAttachmentStore(
			createAttachmentMetaStore(db),
			uploads
		),
		knowledgeStore: createKnowledgeStore(
			createKnowledgeDocumentStore(db),
			uploads
		),
	};
}

export function buildServices(db: Db, uploads?: MultipartBucket) {
	const secretBox = getSecretBox();
	const deps = buildProviderDeps(db, secretBox);
	const sessionStore = createSessionStore(db);
	const messageStore = createMessageStore(db);
	const { attachmentStore, knowledgeStore } = buildUploadStores(db, uploads);
	const cancellation = buildCancellation();
	// Shared across buildRuntime (B1 memory-retrieval / Skills T3 injection) and
	// the stores exposed on context.services — one instance each, not one per use.
	const memoryStore = createMemoryStore(db);
	const memoryItemStore = createMemoryItemStore(db);
	const embeddingClient = buildEmbeddingClient();
	const skillStore = createSkillStore(db);
	const runtime = buildRuntime({
		deps,
		sessionStore,
		messageStore,
		cancellation,
		attachmentStore,
		usageRecordStore: createUsageRecordStore(db),
		memoryStore,
		memoryItemStore,
		embeddingClient,
		skillStore,
	});
	return assembleServices({
		deps,
		runtime,
		cancellation,
		attachmentStore,
		knowledgeStore,
		sessionStore,
		messageStore,
		memoryStore,
		memoryItemStore,
		embeddingClient,
		skillStore,
		db,
		...buildMiscStores(db, secretBox),
	});
}
