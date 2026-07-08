# Provider & Model Management

The provider layer owns everything between the runtime and the upstream model API: resolving a `(providerId, modelId)` pair to a live `LanguageModelV3`, keeping the provider/model catalog synced from models.dev, encrypting credentials at rest, applying provider-specific prompt-cache strategies, and pricing usage.

## Architecture

Three stores and one factory cooperate:

- **`ProviderCatalogStore`** — the provider registry (id, npm adapter package, default base URL, env keys). Populated from models.dev.
- **`ModelCacheStore`** — the model registry (context/output limits, per-million pricing, capabilities). Also from models.dev.
- **`ProviderCredentialStore`** — per-provider API key + base URL, **encrypted at rest**, decrypted only server-side.
- **`ModelFactory`** — combines a catalog entry + a credential into a live `LanguageModelV3`.

All four are interfaces defined in `packages/agent/src/ports.ts` and `provider/types.ts`; the DB-backed implementations live in `packages/db/src/repositories/provider-stores.ts`.

## Key Files

| File | Responsibility |
|------|----------------|
| `packages/agent/src/provider/model-factory.ts` | `createModelFactory` — `(providerId, modelId)` → `LanguageModelV3` |
| `packages/agent/src/provider/adapter-loader.ts` | `loadAdapter` — native SDK vs openai-compatible fallback |
| `packages/agent/src/provider/models-dev.ts` | `fetchModelsDev`, `parseModelsDev` (Zod) |
| `packages/agent/src/provider/model-catalog.ts` | `createModelCatalog` — `sync()` driver, `replaceAll` |
| `packages/agent/src/provider/cache-policy.ts` | `resolveCachePolicy`, `applyCachePolicy` |
| `packages/agent/src/provider/cost.ts` | `priceUsage` — per-million pricing with cache multipliers |
| `packages/agent/src/provider/types.ts` | `ProviderCatalogEntry`, `ModelEntry`, `ProviderCredential` |
| `packages/agent/src/crypto/secret-box.ts` | `createSecretBox` — AES-256-GCM encrypt/decrypt |
| `packages/db/src/schema/providers.ts` | `providersCatalog`, `modelsCache`, `providerCredentials` tables |
| `packages/db/src/repositories/provider-stores.ts` | DB-backed store implementations |

## Data Flow

### Model Factory

`createModelFactory(deps)` (`model-factory.ts:14`) returns:

```ts
interface ModelFactory {
  create(providerId: string, modelId: string): Promise<LanguageModelV3>;
}
```

`create` (`model-factory.ts:16`) does four steps:

1. Look up the provider in the catalog — throw if unknown.
2. Look up the credential — throw if missing or `enabled === false`.
3. Require `provider.npm` (the adapter package) — throw if absent.
4. `loadAdapter(provider.npm, { apiKey, baseURL })` then call it with `modelId`.

`baseURL` precedence: the credential's `baseURL` overrides the catalog's `defaultBaseURL` (`model-factory.ts:30`), letting a user point a provider at a proxy or self-hosted endpoint.

### Adapter Loader

`loadAdapter` (`adapter-loader.ts:66`) tries two paths:

1. **Native adapter** — `NATIVE_ADAPTERS` (`adapter-loader.ts:21`) maps the npm package string to a factory for the five bundled SDKs: `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`, `@ai-sdk/xai`. Each builds the provider instance with `apiKey` + optional `baseURL` and returns a `(modelId) => LanguageModelV3` maker.
2. **Fallback** — `fallbackMaker` (`adapter-loader.ts:52`) builds an `@ai-sdk/openai-compatible` provider. This **requires** a `baseURL` (throws otherwise), since an unknown package without an endpoint can't be reached. The `name` is the npm string, used as the provider's display identity.

### models.dev Catalog Sync

The catalog (both providers and models) is fetched from `https://models.dev/api.json` and parsed with Zod schemas (`models-dev.ts`):

- `ProviderSchema` (`models-dev.ts:18`) — `id`, `name`, `npm`, `api` (base URL), `env` (env-key array), and a `models` record.
- `ModelSchema` (`models-dev.ts:4`) — `id`, `name`, `tool_call`, `reasoning`, `modalities.input`, `cost.input/output`, `limit.context/output`.

`parseModelsDev` (`models-dev.ts:54`) validates the whole blob, optionally filtered to an `allowedProviders` set, and emits `{ providers: ProviderCatalogEntry[], models: ModelEntry[] }`. Field mapping: `modalities.input` containing `"image"` → `capabilities.vision` (`models-dev.ts:33`); missing fields degrade to `null`/`false`.

`createModelCatalog` (`model-catalog.ts:21`) wraps this in a `sync()` operation that fetches, parses, and **`replaceAll`**s both stores atomically per store — `catalogStore.replaceAll(providers)` then `modelStore.replaceAll(models)` (`model-catalog.ts:30`). Each `replaceAll` is a transaction that deletes all rows then inserts the new set (`provider-stores.ts:19`, `provider-stores.ts:43`), so the catalog is always a complete, consistent snapshot. A fetch or parse failure returns `{ ok: false }` and leaves the existing catalog intact (`model-catalog.ts:38`).

### Provider Credentials

Credentials are stored **encrypted** in `providerCredentials.apiKeyCipher` (`packages/db/src/schema/providers.ts:44`). The `ProviderCredentialStore` (`ports.ts:34`) exposes:

- `upsert` — encrypts the key, persists cipher + base URL + enabled flag (`provider-stores.ts:73`, via `onConflictDoUpdate` on `providerId`).
- `get` — returns the **decrypted** `apiKey` (`provider-stores.ts:99`). The interface contract notes decryption happens in the repository.
- `listMasked` — returns `last4` (last 4 chars of the decrypted key) instead of the key itself (`provider-stores.ts:132`), for safe display in the admin UI.
- `delete`.

Encryption is `createSecretBox` (`secret-box.ts:18`):

- **Algorithm**: AES-256-GCM (`ALGORITHM`, `secret-box.ts:8`).
- **Key**: derived via `scryptSync(secret, SALT, KEY_LENGTH)` (`secret-box.ts:19`) — `KEY_LENGTH = 32` bytes, fixed `SALT = "better-agent.secret-box.v1"`. The `secret` is the server's master key.
- **IV**: 12 random bytes per encryption (`IV_LENGTH`, `secret-box.ts:9`).
- **Payload format**: `ivHex:tagHex:dataHex` (`secret-box.ts:30`), where `tag` is the GCM auth tag. `decrypt` (`secret-box.ts:37`) reassembles and verifies the tag — tampering throws.

### Prompt Caching

`resolveCachePolicy` (`cache-policy.ts:31`) maps the provider's npm package to one of three strategies:

| Provider npm | Strategy | Mechanism |
|--------------|----------|-----------|
| `@ai-sdk/anthropic` | `anthropic-breakpoint` | message-level `cacheControl` tags |
| `@ai-sdk/openai`, `@ai-sdk/openai-compatible` | `prompt-cache-key` | `providerOptions.openai.promptCacheKey = sessionId` |
| `@ai-sdk/xai` | `prompt-cache-key` | `providerOptions.xai.promptCacheKey = sessionId` |
| `@ai-sdk/google` | `none` | no caching |
| other | `prompt-cache-key` (openai key) | harmless no-op; the SDK ignores unknown keys |

`applyCachePolicy` (`cache-policy.ts:113`) implements each:

- **`anthropic-breakpoint`** — `tagSystemMessage` (`cache-policy.ts:86`) adds `cacheControl: { type: "ephemeral" }` to the **last** message in the leading contiguous system-message run, so the cached prefix covers the system prompt **and** any compaction summary. `tagLastUserMessage` (`cache-policy.ts:97`) tags the last `user` message so the cache extends through history up to the current prompt. It also returns `cacheToolDefs: true`, which makes `buildTools` tag the last tool's schema (the most expensive part).
- **`prompt-cache-key`** — returns `providerOptions: { [providerKey]: { promptCacheKey: sessionId } }`. The session id is a stable cache key: identical prompts in the same session hit cache; a new session misses.
- **`none`** — passes messages through untouched.

### Cost Calculation

`priceUsage` (`cost.ts:34`) computes USD cost from `MessageUsage` and the model's per-million pricing:

```ts
function computeDollars(usage, pricing): number | null {
  return (
    inputTokens      * inputPricePerM
  + outputTokens     * outputPricePerM
  + cacheReadTokens  * inputPricePerM * CACHE_READ_MULTIPLIER    // 0.1
  + cacheWriteTokens * inputPricePerM * CACHE_WRITE_MULTIPLIER   // 1.25
  + reasoningTokens  * outputPricePerM                            // same as output
  ) / 1_000_000;
}
```

Key rules (`cost.ts`):

- **Cache read is 0.1× input price** (`CACHE_READ_MULTIPLIER = 0.1`, `cost.ts:3`) — cached tokens are cheap.
- **Cache write is 1.25× input price** (`CACHE_WRITE_MULTIPLIER = 1.25`, `cost.ts:4`) — writing to cache costs a premium.
- **Reasoning tokens are priced as output** (`cost.ts:26`) — `reasoningTokens * outputPricePerM`.
- Returns `null` (with `priced: false`) when **either** per-million price is missing for the model (`cost.ts:16`), so unknown pricing is explicit, not silent zero.

The runtime's `finalizeAssistant` (`runtime-finalize.ts:22`) calls this, converts USD to integer cents (`costCents`, `runtime-finalize.ts:34`), and persists it on the message.

## Design Rationale

- **Catalog as a synced snapshot, not live lookups** — models.dev is a third-party JSON blob; fetching it per request would be slow and fragile. `replaceAll` keeps a local, queryable, indexed copy that updates on a schedule.
- **Native first, compatible fallback** — bundled SDKs get full provider features (Anthropic cache control, OpenAI cache keys). Unknown providers still work over OpenAI-compatible HTTP as long as a base URL exists, avoiding the need to bundle every SDK.
- **Credential encryption at the repository boundary** — the store interface returns plaintext (`ports.ts:33` comment), so the runtime never deals with ciphers. The admin UI only ever sees `last4`. The master-key-based `scryptSync` derivation means rotating the key requires re-encrypting all rows (the fixed salt is intentional for v1 simplicity).
- **Strategy-per-provider caching** — each provider exposes caching differently. Centralizing the decision in `resolveCachePolicy` keeps the runtime agnostic; the cache key is the session id, giving per-session prefix reuse without cross-session leakage.
- **Explicit null pricing** — `priced: false` flows through to `costCents: null` on the message, so downstream usage analytics can distinguish "free model" from "unknown price" rather than treating $0 as a real cost.

## Configuration

| Knob | Location | Default | Notes |
|------|----------|---------|-------|
| models.dev URL | `models-dev.ts:29` | `https://models.dev/api.json` | `MODELS_DEV_URL`, overridable in `fetchModelsDev` |
| Encryption algorithm | `secret-box.ts:8` | `aes-256-gcm` | `ALGORITHM` |
| Key derivation | `secret-box.ts:19` | scrypt, 32-byte key | `SALT` fixed at `better-agent.secret-box.v1` |
| IV length | `secret-box.ts:9` | 12 bytes | `IV_LENGTH`, random per encryption |
| Cache-read multiplier | `cost.ts:3` | 0.1 | `CACHE_READ_MULTIPLIER` × input price |
| Cache-write multiplier | `cost.ts:4` | 1.25 | `CACHE_WRITE_MULTIPLIER` × input price |
| Tokens per million | `cost.ts:5` | 1,000,000 | `TOKENS_PER_MILLION` divisor |
| Master secret | env (`SECRET_BOX_SECRET` or equivalent) | — | Passed to `createSecretBox`; not in code |

The master secret and any `allowedProviders` filter are supplied by the server at wiring time (not hardcoded in the provider package).
