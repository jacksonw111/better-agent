import { createAgentValidator } from "@better-agent/agent/agent/agent-validator";
import { createInMemoryRateLimiter } from "@better-agent/agent/auth/rate-limiter";
import { createInMemoryRelayStore } from "@better-agent/agent/bridge/relay-store";
import { createTokenService } from "@better-agent/agent/crypto/agent-token";
import { createSecretBox } from "@better-agent/agent/crypto/secret-box";
import { createModelCatalog } from "@better-agent/agent/provider/model-catalog";
import { createModelFactory } from "@better-agent/agent/provider/model-factory";
import { fetchModelsDev } from "@better-agent/agent/provider/models-dev";
import {
	type CancellationRegistry,
	createInMemoryCancellationRegistry,
} from "@better-agent/agent/session/cancellation";
import { createModelSummarizer } from "@better-agent/agent/session/model-summarizer";
import { createModelTitler } from "@better-agent/agent/session/model-titler";
import { createSessionRuntime } from "@better-agent/agent/session/runtime";
import { createInMemorySessionLock } from "@better-agent/agent/session/session-lock";
import { createInMemoryPendingToolCallStore } from "@better-agent/agent/tool/pending-store";
import { createActivityStore } from "@better-agent/db/repositories/activity-store";
import { createAgentStore } from "@better-agent/db/repositories/agent-store";
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
import {
	createModelCacheStore,
	createProviderCatalogStore,
	createProviderCredentialStore,
} from "@better-agent/db/repositories/provider-stores";
import { createSessionStore } from "@better-agent/db/repositories/session-store";
import { createSettingsStore } from "@better-agent/db/repositories/settings-store";
import { createUsageStore } from "@better-agent/db/repositories/usage-store";
import { createWebAuthzCacheStore } from "@better-agent/db/repositories/web-authz-cache-store";
import { env } from "@better-agent/env/server";
import { Redis as UpstashRedis } from "@upstash/redis";
import Redis from "ioredis";
import { createAttachmentStore, type R2Bucket } from "./attachment-store";
import { buildAuthServices } from "./auth-services";
import { buildAuthzClient, type ServiceBinding } from "./authz-client";
import { buildEmbeddingClient } from "./embedding-client";
import { buildMcpResolver } from "./mcp";
import {
	buildComposioAccountResolver,
	buildGoogleOAuth,
} from "./optional-services";
import { createRedisCancellationRegistry } from "./redis-cancellation";
import { createRedisPendingToolCallStore } from "./redis-pending-store";
import { createRedisRateLimiter } from "./redis-rate-limiter";
import { createRedisRelayStore } from "./redis-relay-store";
import { createRedisSessionLock } from "./redis-session-lock";
import { createUpstashCancellationRegistry } from "./upstash-cancellation";
import { createUpstashPendingToolCallStore } from "./upstash-pending-store";

type Db = Parameters<typeof createAgentStore>[0];

// scrypt key derivation is slow — memoize the secret box per isolate.
let cachedSecretBox: ReturnType<typeof createSecretBox> | null = null;
function getSecretBox() {
	cachedSecretBox ??= createSecretBox(env.CREDENTIALS_SECRET);
	return cachedSecretBox;
}

function buildProviderDeps(
	db: Db,
	secretBox: ReturnType<typeof createSecretBox>
) {
	const providerCatalog = createProviderCatalogStore(db);
	const modelCache = createModelCacheStore(db);
	const providerCredential = createProviderCredentialStore(db, secretBox);
	const agentStore = createAgentStore(db, secretBox);
	const modelFactory = createModelFactory({
		catalogStore: providerCatalog,
		credentialStore: providerCredential,
	});
	const agentValidator = createAgentValidator({
		credentialStore: providerCredential,
		modelStore: modelCache,
	});
	return {
		providerCatalog,
		modelCache,
		providerCredential,
		agentStore,
		modelFactory,
		agentValidator,
	};
}

// Upstash REST client for cross-isolate coordination on Cloudflare Workers.
function upstashRedis(): UpstashRedis | null {
	const url = env.UPSTASH_REDIS_REST_URL;
	const token = env.UPSTASH_REDIS_REST_TOKEN;
	return url && token ? new UpstashRedis({ url, token }) : null;
}

function buildPendingToolCallStore() {
	const upstash = upstashRedis();
	if (upstash) {
		return createUpstashPendingToolCallStore(upstash);
	}
	return env.REDIS_URL
		? createRedisPendingToolCallStore(new Redis(env.REDIS_URL))
		: createInMemoryPendingToolCallStore();
}

function buildSessionLock() {
	return env.REDIS_URL
		? createRedisSessionLock(new Redis(env.REDIS_URL))
		: createInMemorySessionLock();
}

function buildCancellation(): CancellationRegistry {
	const upstash = upstashRedis();
	if (upstash) {
		return createUpstashCancellationRegistry(upstash);
	}
	return env.REDIS_URL
		? createRedisCancellationRegistry(new Redis(env.REDIS_URL))
		: createInMemoryCancellationRegistry();
}

function buildRateLimiter() {
	return env.REDIS_URL
		? createRedisRateLimiter(new Redis(env.REDIS_URL))
		: createInMemoryRateLimiter();
}

function buildRelayStore() {
	return env.REDIS_URL
		? createRedisRelayStore(new Redis(env.REDIS_URL))
		: createInMemoryRelayStore();
}

function buildRuntime(parts: {
	attachmentStore: ReturnType<typeof createAttachmentStore>;
	cancellation: CancellationRegistry;
	deps: ReturnType<typeof buildProviderDeps>;
	messageStore: ReturnType<typeof createMessageStore>;
	sessionStore: ReturnType<typeof createSessionStore>;
}) {
	const { deps, sessionStore, messageStore, cancellation, attachmentStore } =
		parts;
	return createSessionRuntime({
		sessionStore,
		messageStore,
		attachmentStore,
		agentStore: deps.agentStore,
		modelFactory: deps.modelFactory,
		sessionLock: buildSessionLock(),
		modelCacheStore: deps.modelCache,
		providerCatalogStore: deps.providerCatalog,
		summarizer: createModelSummarizer(deps.modelFactory),
		titler: createModelTitler(deps.modelFactory),
		cancellation,
	});
}

function buildStores(parts: {
	attachmentStore: ReturnType<typeof createAttachmentStore>;
	authStores: ReturnType<typeof buildAuthServices>["authStores"];
	bridgeMessageStore: ReturnType<typeof createBridgeMessageStore>;
	bridgeSessionStore: ReturnType<typeof createBridgeSessionStore>;
	bridgeTokenStore: ReturnType<typeof createBridgeTokenStore>;
	bridgeUsageStore: ReturnType<typeof createBridgeUsageStore>;
	composioAccount: ReturnType<typeof createComposioAccountStore>;
	mcpServerStore: ReturnType<typeof createMcpServerStore>;
	deps: ReturnType<typeof buildProviderDeps>;
	messageStore: ReturnType<typeof createMessageStore>;
	sessionStore: ReturnType<typeof createSessionStore>;
	settings: ReturnType<typeof createSettingsStore>;
	usageStore: ReturnType<typeof createUsageStore>;
	activityStore: ReturnType<typeof createActivityStore>;
	webAuthzCache: ReturnType<typeof createWebAuthzCacheStore>;
	db: Db;
}) {
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
		mcpServer: parts.mcpServerStore,
		usage: parts.usageStore,
		activity: parts.activityStore,
		webAuthzCache: parts.webAuthzCache,
		bridgeToken: parts.bridgeTokenStore,
		bridgeSession: parts.bridgeSessionStore,
		bridgeMessage: parts.bridgeMessageStore,
		bridgeUsage: parts.bridgeUsageStore,
		memory: createMemoryStore(parts.db),
		memoryItem: createMemoryItemStore(parts.db),
		...authStores,
	};
}
function assembleServices(parts: {
	attachmentStore: ReturnType<typeof createAttachmentStore>;
	auth: ReturnType<typeof buildAuthServices>;
	authzBinding?: ServiceBinding;
	mcpBinding?: ServiceBinding;
	bridgeMessageStore: ReturnType<typeof createBridgeMessageStore>;
	bridgeSessionStore: ReturnType<typeof createBridgeSessionStore>;
	bridgeTokenStore: ReturnType<typeof createBridgeTokenStore>;
	bridgeUsageStore: ReturnType<typeof createBridgeUsageStore>;
	cancellation: CancellationRegistry;
	composioAccount: ReturnType<typeof createComposioAccountStore>;
	mcpServerStore: ReturnType<typeof createMcpServerStore>;
	deps: ReturnType<typeof buildProviderDeps>;
	messageStore: ReturnType<typeof createMessageStore>;
	runtime: ReturnType<typeof buildRuntime>;
	sessionStore: ReturnType<typeof createSessionStore>;
	settings: ReturnType<typeof createSettingsStore>;
	usageStore: ReturnType<typeof createUsageStore>;
	activityStore: ReturnType<typeof createActivityStore>;
	webAuthzCache: ReturnType<typeof createWebAuthzCacheStore>;
	db: Db;
}) {
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
		embeddingClient: buildEmbeddingClient(),
		mcp: buildMcpResolver(parts.mcpServerStore, parts.mcpBinding),
		authz: buildAuthzClient(parts.authzBinding),
		rateLimiter: buildRateLimiter(),
		relayStore: buildRelayStore(),
		stores: buildStores({ ...parts, authStores: auth.authStores }),
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
	const runtime = buildRuntime({
		deps,
		sessionStore,
		messageStore,
		cancellation,
		attachmentStore,
	});
	return assembleServices({
		deps,
		runtime,
		cancellation,
		attachmentStore,
		sessionStore,
		messageStore,
		usageStore: createUsageStore(db),
		activityStore: createActivityStore(db),
		auth: buildAuthServices(db),
		settings: createSettingsStore(db, secretBox),
		composioAccount: createComposioAccountStore(db, secretBox),
		mcpServerStore: createMcpServerStore(db, secretBox),
		webAuthzCache: createWebAuthzCacheStore(db),
		bridgeTokenStore: createBridgeTokenStore(db),
		bridgeSessionStore: createBridgeSessionStore(db),
		bridgeMessageStore: createBridgeMessageStore(db),
		bridgeUsageStore: createBridgeUsageStore(db),
		db,
		authzBinding,
		mcpBinding,
	});
}
