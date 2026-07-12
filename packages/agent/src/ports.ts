import type { AgentConfig, AgentInput } from "./agent/types";
import type { BridgeAgentKind } from "./bridge-token-ports";
import type {
	ModelEntry,
	ProviderCatalogEntry,
	ProviderCredential,
} from "./provider/types";
import type {
	Message,
	MessageInput,
	MessagePart,
	MessagePartInput,
	MessagePartPatch,
	MessagePatch,
	MessageWithParts,
	Session,
	SessionInput,
	SessionStatus,
} from "./session/types";

export interface ProviderCatalogStore {
	get(providerId: string): Promise<ProviderCatalogEntry | null>;
	list(): Promise<ProviderCatalogEntry[]>;
	replaceAll(entries: ProviderCatalogEntry[]): Promise<void>;
}

export interface ModelCacheStore {
	get(providerId: string, modelId: string): Promise<ModelEntry | null>;
	listByProvider(providerId: string): Promise<ModelEntry[]>;
	replaceAll(entries: ModelEntry[]): Promise<void>;
}

/** 注意：`get` 返回**已解密**的 apiKey；加解密在仓储实现里完成。 */
export interface ProviderCredentialStore {
	delete(providerId: string): Promise<void>;
	get(providerId: string): Promise<ProviderCredential | null>;
	/** 列表用，apiKey 字段被脱敏成末四位。 */
	listMasked(): Promise<
		Array<Omit<ProviderCredential, "apiKey"> & { last4: string }>
	>;
	upsert(input: ProviderCredential): Promise<void>;
}

export interface AgentStore {
	create(
		input: AgentInput & { tokenHash: string; token?: string; userId?: string }
	): Promise<AgentConfig>;
	delete(id: string): Promise<void>;
	findByTokenHash(tokenHash: string): Promise<AgentConfig | null>;
	get(id: string): Promise<AgentConfig | null>;
	/** The agent's current plaintext token, decrypted from storage (null if none). */
	getToken(id: string): Promise<string | null>;
	list(): Promise<AgentConfig[]>;
	listByUser(userId: string): Promise<AgentConfig[]>;
	rotateToken(
		id: string,
		tokenHash: string,
		token?: string
	): Promise<AgentConfig | null>;
	/** Remove a deleted source from every agent. */
	unlinkComposioAccount(userId: string, accountId: string): Promise<void>;
	unlinkMcpServer(userId: string, serverId: string): Promise<void>;
	unlinkOpenConnectorAccount(userId: string, accountId: string): Promise<void>;
	update(id: string, input: AgentInput): Promise<AgentConfig | null>;
}

export interface SessionStore {
	create(input: SessionInput): Promise<Session>;
	get(id: string): Promise<Session | null>;
	list(): Promise<Session[]>;
	listByAgent(agentId: string): Promise<Session[]>;
	listByUser(userId: string): Promise<Session[]>;
	setStatus(id: string, status: SessionStatus): Promise<void>;
	/** 📐 P2 compaction 写入。 */
	setSummary(
		id: string,
		summary: string,
		compactedThroughSeq: number
	): Promise<void>;
	setTitle(id: string, title: string): Promise<void>;
}

export interface MessageStore {
	appendPart(input: MessagePartInput): Promise<MessagePart>;
	createMessage(input: MessageInput): Promise<Message>;
	/** 按 message.seq 升序返回会话全部消息及其 parts（历史回放 + toModelMessages 用）。 */
	listWithParts(sessionId: string): Promise<MessageWithParts[]>;
	updateMessage(id: string, patch: MessagePatch): Promise<Message | null>;
	updatePart(id: string, patch: MessagePartPatch): Promise<MessagePart | null>;
}

// Usage-ledger port lives beside UsageSnapshot; re-exported for one import path.
export type { UsageRecordStore } from "./usage/usage-record";

/** An uploaded attachment's metadata (bytes live in object storage). */
export interface AttachmentRow {
	createdAt: Date;
	id: string;
	messageId: string | null;
	mime: string;
	name: string;
	sessionId: string;
	size: number;
}

export interface AttachmentStore {
	/** Store the bytes + a metadata row (message_id null until linked). */
	create(input: {
		data: Uint8Array;
		mime: string;
		name: string;
		sessionId: string;
	}): Promise<AttachmentRow>;
	getById(id: string): Promise<AttachmentRow | null>;
	/** Raw bytes from object storage; null if the row or object is missing. */
	getBytes(id: string): Promise<Uint8Array | null>;
	/** Bind uploaded attachments to the message they were sent with. */
	linkToMessage(ids: string[], messageId: string): Promise<void>;
	listByMessage(messageId: string): Promise<AttachmentRow[]>;
}

// Auth-related store ports live beside the auth types; re-exported here.
export type {
	MagicLinkStore,
	PasswordResetStore,
	RefreshTokenStore,
	UserStore,
} from "./auth/store-ports";

export type { RelayDir, RelayEvent, RelayStore } from "./bridge/relay-store";

// Memory-system ports live in memory-ports.ts (split out for the 300-line
// limit) and are re-exported so the public ports surface is unchanged.
export type {
	AgentMemoryRow,
	EmbeddingClient,
	MemoryItemRow,
	MemoryItemSource,
	MemoryItemStore,
	MemoryRole,
	MemoryRow,
	MemoryStore,
} from "./memory-ports";
export type { AgentSkillRow, SkillRow, SkillStore } from "./skill-ports";

export interface SettingsStore {
	delete(key: string): Promise<void>;
	get(key: string): Promise<string | null>;
	set(key: string, value: string): Promise<void>;
}

/** A composio account as exposed to clients: never includes the key cipher. */
export interface McpServerRow {
	authLast4: string | null;
	createdAt: Date;
	id: string;
	name: string;
	url: string;
	userId: string;
}

export interface McpServerStore {
	create(input: {
		name: string;
		url: string;
		authHeader?: string;
		userId: string;
	}): Promise<McpServerRow>;
	delete(id: string): Promise<void>;
	/** Decrypted Authorization header value — server-side only. */
	getAuthHeader(id: string): Promise<string | null>;
	getById(id: string): Promise<McpServerRow | null>;
	listByUser(userId: string): Promise<McpServerRow[]>;
	/** Partial patch: omitted fields are untouched; `authHeader: null` clears it. */
	update(
		id: string,
		patch: { name?: string; url?: string; authHeader?: string | null }
	): Promise<McpServerRow | null>;
}

export interface ComposioAccountRow {
	apiKeyLast4: string;
	createdAt: Date;
	id: string;
	name: string;
	/** Owner; null for legacy admin-era accounts. */
	userId: string | null;
}

export interface ComposioAccountStore {
	create(input: {
		name: string;
		apiKey: string;
		userId?: string;
	}): Promise<ComposioAccountRow>;
	delete(id: string): Promise<void>;
	/** Decrypted key — server-side only, for building a ComposioService. */
	getApiKey(id: string): Promise<string | null>;
	getById(id: string): Promise<ComposioAccountRow | null>;
	list(): Promise<ComposioAccountRow[]>;
	listByUser(userId: string): Promise<ComposioAccountRow[]>;
}
export type BridgeSessionStatus = "active" | "ended";
export type {
	BridgeAgentKind,
	BridgeTokenConfig,
	BridgeTokenRow,
	BridgeTokenStore,
} from "./bridge-token-ports";
export type {
	OpenConnectorAccountRow,
	OpenConnectorAccountStore,
} from "./open-connector-ports";

export interface BridgeSessionRow {
	agentKind: BridgeAgentKind;
	agentSessionId: string | null;
	createdAt: Date;
	id: string;
	label: string | null;
	lastSeenAt: Date;
	status: BridgeSessionStatus;
	tokenId: string;
	userId: string;
	vncEndpoint: string | null;
}

export interface BridgeSessionStore {
	create(input: {
		userId: string;
		tokenId: string;
		agentKind: BridgeAgentKind;
		label?: string;
	}): Promise<BridgeSessionRow>;
	end(id: string, userId: string): Promise<void>;
	get(id: string): Promise<BridgeSessionRow | null>;
	listByUser(userId: string): Promise<BridgeSessionRow[]>;
	setAgentSessionId(id: string, agentSessionId: string): Promise<void>;
	setVncEndpoint(id: string, vncEndpoint: string | null): Promise<void>;
	touch(id: string): Promise<void>;
}

/** A persisted bridge event, keyed by the relay's own SERVER-assigned seq. */
export interface BridgeMessageRow {
	event: unknown;
	seq: number;
}

export interface BridgeMessageStore {
	/** Persists one relayed event under its relay-assigned seq. */
	append(sessionId: string, seq: number, event: unknown): Promise<void>;
	/** Persists a batch of relayed events under their own seq, in one round trip. */
	appendMany(sessionId: string, rows: BridgeMessageRow[]): Promise<void>;
	/** Returns persisted events with seq > afterSeq, in ascending seq order. */
	list(
		sessionId: string,
		afterSeq: number,
		limit: number
	): Promise<BridgeMessageRow[]>;
}

export interface WebAuthzCacheRow {
	authorized: boolean;
	checkedAt: Date;
	subject: string;
}

export interface WebAuthzCacheStore {
	clear(subjects: string[]): Promise<void>;
	get(subject: string): Promise<WebAuthzCacheRow | null>;
	set(subject: string, authorized: boolean): Promise<void>;
}

/** Client for the standalone authz (invite-code) service. */
export interface AuthzClient {
	authorize(subject: string): Promise<boolean>;
	/** Whether the authz feature is enabled (AUTHZ_URL configured). */
	readonly enabled: boolean;
	redeem(
		subject: string,
		code: string
	): Promise<{ authorized: boolean; reason?: string }>;
}
export interface EmailSender {
	sendMagicLink(input: { email: string; url: string }): Promise<void>;
	sendPasswordReset(input: { email: string; url: string }): Promise<void>;
}

export interface GoogleProfile {
	email: string;
	emailVerified: boolean;
}
export interface GoogleOAuth {
	/** The Google consent URL to redirect the user to. */
	authUrl(state: string): string;
	/** Exchange the authorization code for the user's verified email. */
	exchangeCode(code: string): Promise<GoogleProfile>;
}
