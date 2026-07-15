import type { AgentValidator } from "@better-agent/agent/agent/agent-validator";
import type { RateLimiter } from "@better-agent/agent/auth/rate-limiter";
import type { BridgeUsageStore } from "@better-agent/agent/bridge/usage-ports";
import type { TokenService } from "@better-agent/agent/crypto/agent-token";
import type { JwtService } from "@better-agent/agent/crypto/jwt";
import type {
	AgentStore,
	AttachmentStore,
	AuthzClient,
	BridgeMessageStore,
	BridgeSessionStore,
	BridgeTokenStore,
	ComposioAccountStore,
	EmailSender,
	EmbeddingClient,
	GoogleOAuth,
	MagicLinkStore,
	McpServerStore,
	MemoryItemStore,
	MemoryStore,
	MessageStore,
	ModelCacheStore,
	OpenConnectorAccountStore,
	PasswordResetStore,
	ProviderCatalogStore,
	ProviderCredentialStore,
	PushService,
	PushSubscriptionStore,
	RefreshTokenStore,
	RelayStore,
	SessionStore,
	SettingsStore,
	SkillStore,
	UserStore,
	WebAuthzCacheStore,
} from "@better-agent/agent/ports";
import type { ModelCatalog } from "@better-agent/agent/provider/model-catalog";
import type { ModelFactory } from "@better-agent/agent/provider/model-factory";
import type { CancellationRegistry } from "@better-agent/agent/session/cancellation";
import type { SessionRuntime } from "@better-agent/agent/session/runtime";
import type { ComposioService } from "@better-agent/agent/tool/composio-tools";
import type { McpService } from "@better-agent/agent/tool/mcp-tools";
import type { OpenConnectorService } from "@better-agent/agent/tool/openconnector-tools";
import type { PendingToolCallStore } from "@better-agent/agent/tool/pending-store";
import type { ActivityStore } from "@better-agent/db/repositories/activity-store";
import type { UsageRecordStore } from "@better-agent/db/repositories/usage-record-store";
import type { UsageStore } from "@better-agent/db/repositories/usage-store";
import type { CommandBus } from "./bridge/command-bus";

export interface AgentServices {
	agentValidator: AgentValidator;
	authConfig: {
		webUrl: string;
		adminUrl: string;
		accessTtl: number;
		refreshTtl: number;
		magicLinkTtl: number;
		adminEmails: string[];
	};
	authz: AuthzClient;
	cancellation: CancellationRegistry;
	catalog: ModelCatalog;
	/** In-process pub/sub notifying a live bridge WS connection that a new
	 * relay command was appended for its session (see command-bus.ts). */
	commandBus: CommandBus;
	composio: (accountId: string) => Promise<ComposioService | null>;
	emailSender: EmailSender;
	/** Memory embeddings via Workers AI (decision D1); null when CF creds unset. */
	embeddingClient: EmbeddingClient | null;
	googleOAuth: GoogleOAuth | null;
	jwtService: JwtService;
	mcp: (serverId: string) => Promise<McpService | null>;
	modelFactory: ModelFactory;
	openConnector: (accountId: string) => Promise<OpenConnectorService | null>;
	pendingToolCallStore: PendingToolCallStore;
	/** Web Push (P3-T3) — null when VAPID keys are not configured, which
	 * disables the whole feature fail-open (subscribe routes error clearly,
	 * the ingest notify hook no-ops). */
	push: PushService | null;
	rateLimiter: RateLimiter;
	relayStore: RelayStore;
	runtime: SessionRuntime;
	stores: {
		providerCatalog: ProviderCatalogStore;
		modelCache: ModelCacheStore;
		providerCredential: ProviderCredentialStore;
		agent: AgentStore;
		session: SessionStore;
		message: MessageStore;
		attachment: AttachmentStore;
		user: UserStore;
		magicLink: MagicLinkStore;
		passwordReset: PasswordResetStore;
		refreshToken: RefreshTokenStore;
		settings: SettingsStore;
		composioAccount: ComposioAccountStore;
		openConnectorAccount: OpenConnectorAccountStore;
		mcpServer: McpServerStore;
		usage: UsageStore;
		usageRecord: UsageRecordStore;
		activity: ActivityStore;
		webAuthzCache: WebAuthzCacheStore;
		bridgeToken: BridgeTokenStore;
		bridgeSession: BridgeSessionStore;
		bridgeMessage: BridgeMessageStore;
		bridgeUsage: BridgeUsageStore;
		memory: MemoryStore;
		memoryItem: MemoryItemStore;
		pushSubscription: PushSubscriptionStore;
		skill: SkillStore;
	};
	tokenService: TokenService;
}
