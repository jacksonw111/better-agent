# 提供商与模型管理

提供商层拥有运行时与上游模型 API 之间的一切：将 `(providerId, modelId)` 对解析为活动的 `LanguageModelV3`、从 models.dev 同步保持提供商/模型目录、对凭据进行静态加密、应用特定于提供商的 prompt 缓存策略，以及为用量定价。

## 架构

三个存储和一个工厂协作：

- **`ProviderCatalogStore`** — 提供商注册表（id、npm 适配器包、默认 base URL、env keys）。从 models.dev 填充。
- **`ModelCacheStore`** — 模型注册表（上下文/输出限制、每百万定价、能力）。同样来自 models.dev。
- **`ProviderCredentialStore`** — 按提供商的 API key + base URL，**静态加密**，仅在服务器端解密。
- **`ModelFactory`** — 将目录条目 + 凭据组合为活动的 `LanguageModelV3`。

这四个都是定义在 `packages/agent/src/ports.ts` 和 `provider/types.ts` 中的接口；基于数据库的实现位于 `packages/db/src/repositories/provider-stores.ts`。

## 关键文件

| 文件 | 职责 |
|------|----------------|
| `packages/agent/src/provider/model-factory.ts` | `createModelFactory` — `(providerId, modelId)` → `LanguageModelV3` |
| `packages/agent/src/provider/adapter-loader.ts` | `loadAdapter` — 原生 SDK vs openai-compatible 回退 |
| `packages/agent/src/provider/models-dev.ts` | `fetchModelsDev`、`parseModelsDev` (Zod) |
| `packages/agent/src/provider/model-catalog.ts` | `createModelCatalog` — `sync()` 驱动、`replaceAll` |
| `packages/agent/src/provider/cache-policy.ts` | `resolveCachePolicy`、`applyCachePolicy` |
| `packages/agent/src/provider/cost.ts` | `priceUsage` — 带缓存乘数的每百万定价 |
| `packages/agent/src/provider/types.ts` | `ProviderCatalogEntry`、`ModelEntry`、`ProviderCredential` |
| `packages/agent/src/crypto/secret-box.ts` | `createSecretBox` — AES-256-GCM 加密/解密 |
| `packages/db/src/schema/providers.ts` | `providersCatalog`、`modelsCache`、`providerCredentials` 表 |
| `packages/db/src/repositories/provider-stores.ts` | 基于数据库的存储实现 |

## 数据流

### 模型工厂

`createModelFactory(deps)`（`model-factory.ts:14`）返回：

```ts
interface ModelFactory {
  create(providerId: string, modelId: string): Promise<LanguageModelV3>;
}
```

`create`（`model-factory.ts:16`）做四步：

1. 在目录中查找提供商——未知则抛出。
2. 查找凭据——缺失或 `enabled === false` 则抛出。
3. 要求 `provider.npm`（适配器包）——缺失则抛出。
4. `loadAdapter(provider.npm, { apiKey, baseURL })` 然后用 `modelId` 调用它。

`baseURL` 优先级：凭据的 `baseURL` 覆盖目录的 `defaultBaseURL`（`model-factory.ts:30`），让用户把提供商指向代理或自托管端点。

### 适配器加载器

`loadAdapter`（`adapter-loader.ts:66`）尝试两条路径：

1. **原生适配器** — `NATIVE_ADAPTERS`（`adapter-loader.ts:21`）将 npm 包字符串映射到五个内置 SDK 的工厂：`@ai-sdk/anthropic`、`@ai-sdk/openai`、`@ai-sdk/google`、`@ai-sdk/xai`。每个用 `apiKey` + 可选 `baseURL` 构建提供商实例，并返回一个 `(modelId) => LanguageModelV3` 制造器。
2. **回退** — `fallbackMaker`（`adapter-loader.ts:52`）构建一个 `@ai-sdk/openai-compatible` 提供商。这**要求**一个 `baseURL`（否则抛出），因为没有端点的未知包无法触达。`name` 是 npm 字符串，用作提供商的显示身份。

### models.dev 目录同步

目录（提供商和模型两者）从 `https://models.dev/api.json` 获取并用 Zod schema 解析（`models-dev.ts`）：

- `ProviderSchema`（`models-dev.ts:18`）— `id`、`name`、`npm`、`api`（base URL）、`env`（env-key 数组）和一个 `models` 记录。
- `ModelSchema`（`models-dev.ts:4`）— `id`、`name`、`tool_call`、`reasoning`、`modalities.input`、`cost.input/output`、`limit.context/output`。

`parseModelsDev`（`models-dev.ts:54`）验证整个 blob，可选地过滤为 `allowedProviders` 集合，并产出 `{ providers: ProviderCatalogEntry[], models: ModelEntry[] }`。字段映射：`modalities.input` 包含 `"image"` → `capabilities.vision`（`models-dev.ts:33`）；缺失字段降级为 `null`/`false`。

`createModelCatalog`（`model-catalog.ts:21`）将其包装在一个 `sync()` 操作中，该操作获取、解析并按存储原子地 **`replaceAll`** 两个存储——先 `catalogStore.replaceAll(providers)` 再 `modelStore.replaceAll(models)`（`model-catalog.ts:30`）。每个 `replaceAll` 是一个事务，先删除所有行再插入新集合（`provider-stores.ts:19`、`provider-stores.ts:43`），因此目录始终是完整、一致的快照。获取或解析失败返回 `{ ok: false }` 并保持现有目录不变（`model-catalog.ts:38`）。

### 提供商凭据

凭据以**加密**形式存储在 `providerCredentials.apiKeyCipher`（`packages/db/src/schema/providers.ts:44`）。`ProviderCredentialStore`（`ports.ts:34`）暴露：

- `upsert` — 加密 key，持久化 cipher + base URL + enabled 标志（`provider-stores.ts:73`，通过 `providerId` 上的 `onConflictDoUpdate`）。
- `get` — 返回**解密后的** `apiKey`（`provider-stores.ts:99`）。接口契约注明解密发生在 repository 中。
- `listMasked` — 返回 `last4`（解密后 key 的最后 4 个字符）而非 key 本身（`provider-stores.ts:132`），用于管理后台 UI 的安全显示。
- `delete`。

加密是 `createSecretBox`（`secret-box.ts:18`）：

- **算法**：AES-256-GCM（`ALGORITHM`，`secret-box.ts:8`）。
- **密钥**：通过 `scryptSync(secret, SALT, KEY_LENGTH)`（`secret-box.ts:19`）派生——`KEY_LENGTH = 32` 字节，固定 `SALT = "better-agent.secret-box.v1"`。`secret` 是服务器的主密钥。
- **IV**：每次加密 12 个随机字节（`IV_LENGTH`，`secret-box.ts:9`）。
- **载荷格式**：`ivHex:tagHex:dataHex`（`secret-box.ts:30`），其中 `tag` 是 GCM 认证标签。`decrypt`（`secret-box.ts:37`）重组并验证标签——篡改会抛出。

### Prompt 缓存

`resolveCachePolicy`（`cache-policy.ts:31`）将提供商的 npm 包映射为三种策略之一：

| 提供商 npm | 策略 | 机制 |
|--------------|----------|-----------|
| `@ai-sdk/anthropic` | `anthropic-breakpoint` | 消息级 `cacheControl` 标签 |
| `@ai-sdk/openai`、`@ai-sdk/openai-compatible` | `prompt-cache-key` | `providerOptions.openai.promptCacheKey = sessionId` |
| `@ai-sdk/xai` | `prompt-cache-key` | `providerOptions.xai.promptCacheKey = sessionId` |
| `@ai-sdk/google` | `none` | 无缓存 |
| 其他 | `prompt-cache-key`（openai key） | 无害的空操作；SDK 忽略未知 key |

`applyCachePolicy`（`cache-policy.ts:113`）实现每一个：

- **`anthropic-breakpoint`** — `tagSystemMessage`（`cache-policy.ts:86`）在开头连续 system 消息段的**最后一条**消息上添加 `cacheControl: { type: "ephemeral" }`，使缓存前缀覆盖系统 prompt **以及**任何压缩摘要。`tagLastUserMessage`（`cache-policy.ts:97`）标注最后一条 `user` 消息，使缓存延伸至覆盖到当前 prompt 为止的历史。它还返回 `cacheToolDefs: true`，使 `buildTools` 标注最后一个工具的 schema（最昂贵的部分）。
- **`prompt-cache-key`** — 返回 `providerOptions: { [providerKey]: { promptCacheKey: sessionId } }`。会话 id 是稳定的缓存 key：同一会话中相同的 prompt 命中缓存；新会话则未命中。
- **`none`** — 透传消息，不做改动。

### 成本计算

`priceUsage`（`cost.ts:34`）从 `MessageUsage` 和模型的每百万定价计算美元成本：

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

关键规则（`cost.ts`）：

- **缓存读取是 0.1× 输入价格**（`CACHE_READ_MULTIPLIER = 0.1`，`cost.ts:3`）— 缓存的 token 廉价。
- **缓存写入是 1.25× 输入价格**（`CACHE_WRITE_MULTIPLIER = 1.25`，`cost.ts:4`）— 写入缓存需付溢价。
- **推理 token 按输出定价**（`cost.ts:26`）— `reasoningTokens * outputPricePerM`。
- 当模型**任一**每百万价格缺失时返回 `null`（含 `priced: false`）（`cost.ts:16`），因此未知定价是显式的，而非静默零。

运行时的 `finalizeAssistant`（`runtime-finalize.ts:22`）调用它，将美元转换为整数美分（`costCents`，`runtime-finalize.ts:34`），并持久化到消息上。

## 设计理由

- **目录作为同步快照，而非实时查询** — models.dev 是第三方 JSON blob；按请求获取会缓慢且脆弱。`replaceAll` 保持一个本地的、可查询的、有索引的副本，按计划更新。
- **原生优先，兼容回退** — 内置 SDK 获得完整提供商特性（Anthropic 缓存控制、OpenAI 缓存 key）。未知提供商只要存在 base URL，仍可通过 OpenAI 兼容的 HTTP 工作，避免捆绑每个 SDK。
- **凭据加密在 repository 边界** — 存储接口返回明文（`ports.ts:33` 注释），因此运行时从不处理 cipher。管理后台 UI 只能看到 `last4`。基于主密钥的 `scryptSync` 派生意味着轮换密钥需要重新加密所有行（固定 salt 是 v1 简化的有意选择）。
- **按提供商的缓存策略** — 每个提供商以不同方式暴露缓存。将决策集中在 `resolveCachePolicy` 保持运行时无关；缓存 key 是会话 id，提供按会话的前缀复用而无跨会话泄漏。
- **显式 null 定价** — `priced: false` 流向消息上的 `costCents: null`，因此下游用量分析可以区分“免费模型”与“未知价格”，而非把 $0 当作真实成本。

## 配置

| 旋钮 | 位置 | 默认值 | 备注 |
|------|----------|---------|-------|
| models.dev URL | `models-dev.ts:29` | `https://models.dev/api.json` | `MODELS_DEV_URL`，可在 `fetchModelsDev` 中覆盖 |
| 加密算法 | `secret-box.ts:8` | `aes-256-gcm` | `ALGORITHM` |
| 密钥派生 | `secret-box.ts:19` | scrypt，32 字节密钥 | `SALT` 固定为 `better-agent.secret-box.v1` |
| IV 长度 | `secret-box.ts:9` | 12 字节 | `IV_LENGTH`，每次加密随机 |
| 缓存读取乘数 | `cost.ts:3` | 0.1 | `CACHE_READ_MULTIPLIER` × 输入价格 |
| 缓存写入乘数 | `cost.ts:4` | 1.25 | `CACHE_WRITE_MULTIPLIER` × 输入价格 |
| 每百万 token 数 | `cost.ts:5` | 1,000,000 | `TOKENS_PER_MILLION` 除数 |
| 主密钥 | 环境变量（`SECRET_BOX_SECRET` 或等价） | — | 传给 `createSecretBox`；不在代码中 |

主密钥和任何 `allowedProviders` 过滤器在装配时由服务器提供（未硬编码在 provider 包中）。
