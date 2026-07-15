import { createTokenService } from "@better-agent/agent/crypto/agent-token";
import { createModelCatalog } from "@better-agent/agent/provider/model-catalog";
import { fetchModelsDev } from "@better-agent/agent/provider/models-dev";
import type { CancellationRegistry } from "@better-agent/agent/session/cancellation";
import { createModelSummarizer } from "@better-agent/agent/session/model-summarizer";
import { createModelTitler } from "@better-agent/agent/session/model-titler";
import { createSessionRuntime } from "@better-agent/agent/session/runtime";
import { createCommandBus } from "@better-agent/api/bridge/command-bus";
import { createActivityStore } from "@better-agent/db/repositories/activity-store";
import { createAttachmentMetaStore } from "@better-agent/db/repositories/attachment-meta-store";
import { createBridgeMessageStore } from "@better-agent/db/repositories/bridge-message-store";
import { createBridgeSessionStore } from "@better-agent/db/repositories/bridge-session-store";
import { createBridgeTokenStore } from "@better-agent/db/repositories/bridge-token-store";
import { createBridgeUsageStore } from "@better-agent/db/repositories/bridge-usage-store";
import { createComposioAccountStore } from "@better-agent/db/repositories/composio-account-store";
import { createMcpServerStore } from "@better-agent/db/repositories/mcp-server-store";
import { createMemoryItemStore } from "@better-agent/db/repositories/memory-item-store";
import { createMemoryStore } from "@better-agent/db/repositories/memory-store";
import { createMessageStore } from "@better-agent/db/repositories/message-store";
import { createOpenConnectorAccountStore } from "@better-agent/db/repositories/openconnector-account-store";
import { createPushSubscriptionStore } from "@better-agent/db/repositories/push-subscription-store";
import { createSessionStore } from "@better-agent/db/repositories/session-store";
import { createSettingsStore } from "@better-agent/db/repositories/settings-store";
import { createSkillStore } from "@better-agent/db/repositories/skill-store";
import { createUsageRecordStore } from "@better-agent/db/repositories/usage-record-store";
import { createUsageStore } from "@better-agent/db/repositories/usage-store";
import { createWebAuthzCacheStore } from "@better-agent/db/repositories/web-authz-cache-store";
import { env } from "@better-agent/env/server";
import { createAttachmentStore, type R2Bucket } from "./attachment-store";
import { buildAuthServices } from "./auth-services";
import { buildAuthzClient, type ServiceBinding } from "./authz-client";
import { buildEmbeddingClient } from "./embedding-client";
import { buildMcpResolver } from "./mcp";
import {
	buildComposioAccountResolver,
	buildGoogleOAuth,
	buildOpenConnectorAccountResolver,
} from "./optional-services";
import { buildPushService } from "./push-sender";
import {
	buildCancellation,
	buildPendingToolCallStore,
	buildProviderDeps,
	buildRateLimiter,
	buildRelayStore,
	buildSessionLock,
	type Db,
	getSecretBox,
} from "./services-infra";

function buildRuntime(parts: {
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

// Shared by buildStores + assembleServices (both take "everything needed to
// construct a store"); factored out so neither signature repeats the list.
interface StoreParts {
	activityStore: ReturnType<typeof createActivityStore>;
	attachmentStore: ReturnType<typeof createAttachmentStore>;
	bridgeMessageStore: ReturnType<typeof createBridgeMessageStore>;
	bridgeSessionStore: ReturnType<typeof createBridgeSessionStore>;
	bridgeTokenStore: ReturnType<typeof createBridgeTokenStore>;
	bridgeUsageStore: ReturnType<typeof createBridgeUsageStore>;
	composioAccount: ReturnType<typeof createComposioAccountStore>;
	db: Db;
	deps: ReturnType<typeof buildProviderDeps>;
	embeddingClient: ReturnType<typeof buildEmbeddingClient>;
	mcpServerStore: ReturnType<typeof createMcpServerStore>;
	memoryItemStore: ReturnType<typeof createMemoryItemStore>;
	memoryStore: ReturnType<typeof createMemoryStore>;
	messageStore: ReturnType<typeof createMessageStore>;
	openConnectorAccount: ReturnType<typeof createOpenConnectorAccountStore>;
	pushSubscriptionStore: ReturnType<typeof createPushSubscriptionStore>;
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
		bridgeToken: parts.bridgeTokenStore,
		bridgeSession: parts.bridgeSessionStore,
		bridgeMessage: parts.bridgeMessageStore,
		bridgeUsage: parts.bridgeUsageStore,
		memory: parts.memoryStore,
		memoryItem: parts.memoryItemStore,
		pushSubscription: parts.pushSubscriptionStore,
		skill: parts.skillStore,
		...authStores,
	};
}
function assembleServices(
	parts: StoreParts & {
		auth: ReturnType<typeof buildAuthServices>;
		authzBinding?: ServiceBinding;
		mcpBinding?: ServiceBinding;
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
		mcp: buildMcpResolver(parts.mcpServerStore, parts.mcpBinding),
		authz: buildAuthzClient(parts.authzBinding),
		// P3-T3: Web Push — null (feature disabled fail-open) without VAPID keys.
		push: buildPushService(parts.pushSubscriptionStore),
		rateLimiter: buildRateLimiter(),
		relayStore: buildRelayStore(),
		// In-process pub/sub "bell" waking a live bridge WS connection to re-read
		// the commands relay for its session — see command-bus.ts. Deliberately
		// NOT persisted/shared across processes: a WS connection always lives on
		// the same Node process as the CommandBus instance that can notify it.
		commandBus: createCommandBus(),
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
		pushSubscriptionStore: createPushSubscriptionStore(db),
		webAuthzCache: createWebAuthzCacheStore(db),
		bridgeTokenStore: createBridgeTokenStore(db),
		bridgeSessionStore: createBridgeSessionStore(db),
		bridgeMessageStore: createBridgeMessageStore(db),
		bridgeUsageStore: createBridgeUsageStore(db),
	};
}

export function buildServices(
	db: Db,
	authzBinding?: ServiceBinding,
	uploads?: R2Bucket,
	mcpBinding?: ServiceBinding
) {
	const secretBox = getSecretBox();
	const deps = buildProviderDeps(db, secretBox);
	const sessionStore = createSessionStore(db);
	const messageStore = createMessageStore(db);
	const attachmentStore = createAttachmentStore(
		createAttachmentMetaStore(db),
		uploads
	);
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
		sessionStore,
		messageStore,
		memoryStore,
		memoryItemStore,
		embeddingClient,
		skillStore,
		db,
		authzBinding,
		mcpBinding,
		...buildMiscStores(db, secretBox),
	});
}
