import { createTokenService } from "@better-agent/agent/crypto/agent-token";
import { createReplayGuard } from "@better-agent/agent/crypto/computer-signature";
import { createGithubClient } from "@better-agent/agent/github/github-client";
import { createModelCatalog } from "@better-agent/agent/provider/model-catalog";
import { fetchModelsDev } from "@better-agent/agent/provider/models-dev";
import type { CancellationRegistry } from "@better-agent/agent/session/cancellation";
import { createCommandBus } from "@better-agent/api/bridge/command-bus";
import { createComputerControlChannel } from "@better-agent/api/computers/control-channel";
import { createActiveSessionStore } from "@better-agent/db/repositories/active-session-store";
import { createActivityStore } from "@better-agent/db/repositories/activity-store";
import { createAttachmentMetaStore } from "@better-agent/db/repositories/attachment-meta-store";
import { createBridgeMessageStore } from "@better-agent/db/repositories/bridge-message-store";
import { createBridgeSessionStore } from "@better-agent/db/repositories/bridge-session-store";
import { createBridgeTokenStore } from "@better-agent/db/repositories/bridge-token-store";
import { createBridgeUsageStore } from "@better-agent/db/repositories/bridge-usage-store";
import { createComposioAccountStore } from "@better-agent/db/repositories/composio-account-store";
import { createComputerStore } from "@better-agent/db/repositories/computer-store";
import { createGithubConnectionStore } from "@better-agent/db/repositories/github-connection-store";
import { createKnowledgeDocumentStore } from "@better-agent/db/repositories/knowledge-document-store";
import { createMcpServerStore } from "@better-agent/db/repositories/mcp-server-store";
import { createMemoryItemStore } from "@better-agent/db/repositories/memory-item-store";
import { createMemoryStore } from "@better-agent/db/repositories/memory-store";
import { createMessageStore } from "@better-agent/db/repositories/message-store";
import { createOpenConnectorAccountStore } from "@better-agent/db/repositories/openconnector-account-store";
import { createProjectStore } from "@better-agent/db/repositories/project-store";
import { createPushSubscriptionStore } from "@better-agent/db/repositories/push-subscription-store";
import { createRunStore } from "@better-agent/db/repositories/run-store";
import { createSessionStore } from "@better-agent/db/repositories/session-store";
import { createSettingsStore } from "@better-agent/db/repositories/settings-store";
import { createSkillStore } from "@better-agent/db/repositories/skill-store";
import { createTaskStore } from "@better-agent/db/repositories/task-store";
import { createUsageRecordStore } from "@better-agent/db/repositories/usage-record-store";
import { createUsageStore } from "@better-agent/db/repositories/usage-store";
import { createWebAuthzCacheStore } from "@better-agent/db/repositories/web-authz-cache-store";
import { env } from "@better-agent/env/server";
import { createAttachmentStore } from "./attachment-store";
import { buildAuthServices } from "./auth-services";
import { buildAuthzClient, type ServiceBinding } from "./authz-client";
import { buildEmbeddingClient } from "./embedding-client";
import { createKnowledgeStore, type MultipartBucket } from "./knowledge-store";
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
	type Db,
	getSecretBox,
} from "./services-infra";
import { buildRuntime } from "./services-runtime";

// Shared by buildStores + assembleServices (both take "everything needed to
// construct a store"); factored out so neither signature repeats the list.
interface StoreParts {
	activeSessionStore: ReturnType<typeof createActiveSessionStore>;
	activityStore: ReturnType<typeof createActivityStore>;
	attachmentStore: ReturnType<typeof createAttachmentStore>;
	bridgeMessageStore: ReturnType<typeof createBridgeMessageStore>;
	bridgeSessionStore: ReturnType<typeof createBridgeSessionStore>;
	bridgeTokenStore: ReturnType<typeof createBridgeTokenStore>;
	bridgeUsageStore: ReturnType<typeof createBridgeUsageStore>;
	composioAccount: ReturnType<typeof createComposioAccountStore>;
	computerStore: ReturnType<typeof createComputerStore>;
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
	projectStore: ReturnType<typeof createProjectStore>;
	pushSubscriptionStore: ReturnType<typeof createPushSubscriptionStore>;
	runStore: ReturnType<typeof createRunStore>;
	secretBox: ReturnType<typeof getSecretBox>;
	sessionStore: ReturnType<typeof createSessionStore>;
	settings: ReturnType<typeof createSettingsStore>;
	skillStore: ReturnType<typeof createSkillStore>;
	taskStore: ReturnType<typeof createTaskStore>;
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
		computer: parts.computerStore,
		githubConnection: parts.githubConnectionStore,
		knowledge: parts.knowledgeStore,
		memory: parts.memoryStore,
		memoryItem: parts.memoryItemStore,
		project: parts.projectStore,
		pushSubscription: parts.pushSubscriptionStore,
		activeSession: parts.activeSessionStore,
		run: parts.runStore,
		skill: parts.skillStore,
		task: parts.taskStore,
		...authStores,
	};
}
// S2-T2 (D4): /computer-ws registry + command push (launch + Q1 clone).
// In-process like commandBus — a live WS is always on the same Node process;
// heartbeat pendingCommands covers the no-WS gap.
function buildComputerControl(parts: StoreParts) {
	return createComputerControlChannel({
		bridgeToken: parts.bridgeTokenStore,
		computer: parts.computerStore,
		project: parts.projectStore,
		run: parts.runStore,
		secretBox: parts.secretBox,
		task: parts.taskStore,
	});
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
		// S4-T1 (D7): real fetch-based GitHub client, one instance per decrypted
		// PAT. Routers decrypt via secretBox right before calling this — the
		// token never rests anywhere but as secret-box ciphertext.
		githubClient: (token: string) => createGithubClient({ token }),
		secretBox: parts.secretBox,
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
		// Computer-plane anti-replay (S1-T2, design D1). In-memory on purpose:
		// signature timestamps must strictly increase per computer, and the
		// single-instance Docker deployment means one process sees them all.
		computerReplayGuard: createReplayGuard(),
		computerControl: buildComputerControl(parts),
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
		computerStore: createComputerStore(db),
		githubConnectionStore: createGithubConnectionStore(db),
		projectStore: createProjectStore(db),
		taskStore: createTaskStore(db),
		runStore: createRunStore(db),
		activeSessionStore: createActiveSessionStore(db),
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

export function buildServices(
	db: Db,
	authzBinding?: ServiceBinding,
	uploads?: MultipartBucket,
	mcpBinding?: ServiceBinding
) {
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
		authzBinding,
		mcpBinding,
		...buildMiscStores(db, secretBox),
	});
}
