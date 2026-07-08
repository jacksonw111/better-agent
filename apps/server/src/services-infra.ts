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
import { Redis as UpstashRedis } from "@upstash/redis";
import Redis from "ioredis";
import { createRedisCancellationRegistry } from "./redis-cancellation";
import { createRedisPendingToolCallStore } from "./redis-pending-store";
import { createRedisRateLimiter } from "./redis-rate-limiter";
import { createRedisRelayStore } from "./redis-relay-store";
import { createRedisSessionLock } from "./redis-session-lock";
import { createUpstashCancellationRegistry } from "./upstash-cancellation";
import { createUpstashPendingToolCallStore } from "./upstash-pending-store";

// Low-level infra builders shared by services.ts, split out so that file
// stays under the repo's 300-line cap. Each `build*` picks Upstash (Workers,
// cross-isolate) > node-redis (single-process dev/self-host) > in-memory
// (tests / no REDIS_URL configured) — see client-tools-need-redis-on-workers
// for why the in-memory fallback doesn't cross Workers isolates.

export type Db = Parameters<typeof createAgentStore>[0];

// scrypt key derivation is slow — memoize the secret box per isolate.
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

// Upstash REST client for cross-isolate coordination on Cloudflare Workers.
function upstashRedis(): UpstashRedis | null {
	const url = env.UPSTASH_REDIS_REST_URL;
	const token = env.UPSTASH_REDIS_REST_TOKEN;
	return url && token ? new UpstashRedis({ url, token }) : null;
}

export function buildPendingToolCallStore() {
	const upstash = upstashRedis();
	if (upstash) {
		return createUpstashPendingToolCallStore(upstash);
	}
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
	const upstash = upstashRedis();
	if (upstash) {
		return createUpstashCancellationRegistry(upstash);
	}
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
