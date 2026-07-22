import { createAgentValidator } from "@better-agent/agent/agent/agent-validator";
import { createInMemoryRateLimiter } from "@better-agent/agent/auth/rate-limiter";
import { createInMemoryRelayStore } from "@better-agent/agent/bridge/relay-store";
import { createSecretBox } from "@better-agent/agent/crypto/secret-box";
import { createModelFactory } from "@better-agent/agent/provider/model-factory";
import {
	type CancellationRegistry,
	createInMemoryCancellationRegistry,
} from "@better-agent/agent/session/cancellation";
import { createInMemorySessionLock } from "@better-agent/agent/session/session-lock";
import { createInMemoryPendingToolCallStore } from "@better-agent/agent/tool/pending-store";
import { createAgentStore } from "@better-agent/db/repositories/agent-store";
import {
	createModelCacheStore,
	createProviderCatalogStore,
	createProviderCredentialStore,
} from "@better-agent/db/repositories/provider-stores";
import { env } from "@better-agent/env/server";
import Redis from "ioredis";
import { createRedisCancellationRegistry } from "./redis-cancellation";
import { createRedisPendingToolCallStore } from "./redis-pending-store";
import { createRedisRateLimiter } from "./redis-rate-limiter";
import { createRedisRelayStore } from "./redis-relay-store";
import { createRedisSessionLock } from "./redis-session-lock";

// Low-level infra builders shared by services.ts, split out so that file
// stays under the repo's 300-line cap. Each `build*` picks node-redis (shared
// state across processes when REDIS_URL is set — needed for horizontal scaling
// and for client/remote tool-call results to reach the streaming turn) >
// in-memory (single-process dev / tests / no REDIS_URL configured).

export type Db = Parameters<typeof createAgentStore>[0];

// scrypt key derivation is slow — memoize the secret box for the process.
let cachedSecretBox: ReturnType<typeof createSecretBox> | null = null;
export function getSecretBox() {
	cachedSecretBox ??= createSecretBox(env.CREDENTIALS_SECRET);
	return cachedSecretBox;
}

export function buildProviderDeps(
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

export function buildPendingToolCallStore() {
	return env.REDIS_URL
		? createRedisPendingToolCallStore(new Redis(env.REDIS_URL))
		: createInMemoryPendingToolCallStore();
}

export function buildSessionLock() {
	return env.REDIS_URL
		? createRedisSessionLock(new Redis(env.REDIS_URL))
		: createInMemorySessionLock();
}

export function buildCancellation(): CancellationRegistry {
	return env.REDIS_URL
		? createRedisCancellationRegistry(new Redis(env.REDIS_URL))
		: createInMemoryCancellationRegistry();
}

export function buildRateLimiter() {
	return env.REDIS_URL
		? createRedisRateLimiter(new Redis(env.REDIS_URL))
		: createInMemoryRateLimiter();
}

export function buildRelayStore() {
	return env.REDIS_URL
		? createRedisRelayStore(new Redis(env.REDIS_URL))
		: createInMemoryRelayStore();
}
