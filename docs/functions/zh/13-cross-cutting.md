# 横切关注点

有四个关注点横切 better-agent 中的每个特性：密钥的静态加密、每个客户端和服务端 procedure 都使用的带类型 RPC 框架、结构化日志，以及带"禁用原生 SQL"守卫的 Drizzle ORM 层。本文档涵盖它们所提供的共享基础设施。

## 架构

```
apps/server/src/services.ts  (composition root)
  │
  ├─ getSecretBox()  ──▶ createSecretBox(env.CREDENTIALS_SECRET)  [memoized per isolate]
  │       └─ injected into every store that touches an encrypted column
  │
  ├─ buildServices(db, …) ─▶ { stores, runtime, modelFactory, catalog, … }
  │       └─ createXStore(db, secretBox) for each repository
  │
  └─ app.ts (HTTP wiring)
        ├─ createContext({ context, services })   [per-request]
        ├─ RPCHandler(appRouter) + OpenAPIHandler(appRouter)
        ├─ evlog() middleware (skipped on streaming paths)
        ├─ onError → log.error + CORS re-apply
        └─ /rpc, /api-reference, /mcp/memory, /bridge/…/stream, /internal/authz-invalidate
```

服务端在启动时通过 `buildServices` 一次性组装，为每个 store 和协作者提供具体实现，然后 `buildApp` 将该服务集合接入 Hono 中间件 + oRPC 处理器。每个请求都会重建一个 `Context`，它从 bearer token 解析认证并将服务集合贯穿其中，因此 procedure 是 `(input, context)` 的纯函数。

## 关键文件

| 文件 | 职责 |
|------|----------------|
| `packages/agent/src/crypto/secret-box.ts` | `createSecretBox` — 带 scrypt 密钥派生的 AES-256-GCM 封存/开启 |
| `packages/api/src/index.ts` | Procedure 构造器：`publicProcedure`、`agentProcedure`、`bridgeProcedure`、`userProcedure`、`adminProcedure`、`authorizedUserProcedure` |
| `packages/api/src/context.ts` | `createContext` — bearer token 分发（JWT / agent token / bridge token）、`clientIp`、`waitUntil` |
| `packages/api/src/routers/index.ts` | `appRouter` — 将全部 16 个子路由器组合为一个带类型的契约 |
| `apps/server/src/services.ts` | 组合根：`buildServices(db, …)` — 记忆化的 SecretBox、供应商依赖、Redis/Upstash/内存存储选择 |
| `apps/server/src/app.ts` | HTTP 接线：CORS、evlog、oRPC RPC + OpenAPI 处理器、bridge SSE、内部路由 |
| `packages/db/src/schema/index.ts` | 每个 Drizzle schema 模块的 barrel 再导出 |
| `packages/db/src/schema/*.ts` | 表定义（agents、sessions、auth、bridge、memory、providers、usage、…） |
| `packages/db/src/repositories/*.ts` | 仓储模式：`createXStore(db, …)` 工厂，每个聚合一个 |
| `scripts/check-no-raw-sql.js` | pre-commit 守卫：拒绝 `packages/db/` 中的 `sql\`…\`` 标签模板 |
| `lefthook.yml` | Git 钩子：format、lint、file-rules、no-raw-sql、eslint、package-json、tailwind、type-check、约定式提交 |

## 数据流

### 加密（SecretBox）

`createSecretBox(secret)` (`packages/agent/src/crypto/secret-box.ts:18`) 通过带固定盐值的 `scryptSync` 从调用方提供的 `secret`（例如 `env.CREDENTIALS_SECRET`）派生一个 32 字节密钥，然后返回 `{ encrypt, decrypt }`：

- **`encrypt(plaintext)`** — 生成一个新的 12 字节 IV（`IV_LENGTH = 12`），`createCipheriv("aes-256-gcm", key, iv)`，加密，取出 auth tag，并返回以冒号连接的载荷 `ivHex:tagHex:dataHex`。
- **`decrypt(payload)`** — 按 `:` 分割（必须恰好得到 iv/tag/data），重建 decipher，`setAuthTag`，解密。错误的密钥、被篡改的载荷或被截断的载荷都会抛出异常。

GCM 的 auth tag 意味着对载荷的任何修改（或错误的密钥）都会在 `decipher.final()` 处失败 — 不会有静默损坏。12 字节 IV 在每次加密时随机化，因此相同的明文会产生不同的密文。

该 `secret` 是 `env.CREDENTIALS_SECRET`。服务端每个 isolate 记忆一个 `SecretBox`（`services.ts:63` `cachedSecretBox`），因为 `scryptSync` 被刻意设计得很慢；每次调用都重新派生会很浪费。同一个实例被注入到每个拥有加密列的 store 中 — `agentStore`（agent 令牌）、`providerCredential`（API 密钥）、`settingsStore`、`composioAccountStore`、`mcpServerStore`。

### oRPC 框架

oRPC 是带类型的 RPC 层。服务端路由器是一个由 procedure 组成的普通对象，在 `packages/api/src/routers/index.ts:19` 中组合：

```
appRouter = {
  healthCheck, auth, account, activity, admin, bridge, composio,
  invite, mcp, memory, providers, agents, sessions, usage, userSessions
}
```

`AppRouter = typeof appRouter` 是契约的唯一真实来源。`RouterClient<AppRouter>`（`@orpc/server`）是带类型的客户端类型 — SDK（`packages/client`）、web 应用和 admin 应用都基于它构建各自的 oRPC 客户端，因此输入形态的变更在任何地方都是编译错误。

**Procedure 构造器**（`packages/api/src/index.ts`）分层叠加认证中间件：

| 构造器 | 门禁 |
|---------|------|
| `publicProcedure` | 无 |
| `agentProcedure` | `authedAgent`（agent token `ba_…`） |
| `bridgeProcedure` | `authedBridgeToken`（`bt_…`） |
| `userProcedure` | `requireActiveUser` — JWT 用户，未被封禁 |
| `adminProcedure` | `userProcedure` + `isAdminEmail`/`isAdmin` |
| `authorizedUserProcedure` | `userProcedure` + 邀请/authz 门禁（员工绕过） |

`requireActiveUser`（`index.ts:34`）是实时封禁校验：它在每次请求时重新读取用户记录，并以 FORBIDDEN 拒绝被封禁用户，因此封禁立即生效（无需令牌黑名单）。

客户端的**链路拦截器**添加横切行为。admin 的 oRPC 客户端（`apps/admin/src/utils/orpc.ts`）有一个刷新拦截器：遇到 UNAUTHORIZED 时，尝试一次 `auth.refresh`（通过 `refreshInFlight` 去重），成功则重试原始调用，失败则重定向到 `/login`。

**TanStack Query 集成**通过 `createTanstackQueryUtils(client)` → `orpc.<router>.<proc>.queryOptions({ input })` / `mutationOptions(…)` 实现，为每个 procedure 提供带类型的查询键和结果，零样板代码。

**流式端点**跳过日志中间件（`apps/server/src/app.ts:25` `STREAMING_PATHS`），因为它会缓冲响应体，这会锁住 `ReadableStream` 并破坏 SSE/回合流。出于同样原因，RPC 处理器直接返回处理器的 `Response`（`app.ts:104`）— 重新包装会附上第二个 reader。

### Evlog 日志

`evlog` 是结构化日志库。`app.ts:69` 将 `evlog()` 作为中间件应用于每个非流式路径，每个请求发出一个宽事件。`onError`（RPC 处理器拦截器中的 `app.ts:52`，以及 Hono 应用上的 `app.ts:80`）调用 `log.error({ error })`，使抛出的错误连同其堆栈和上下文被捕获。

宽事件形态意味着每条日志记录都是一个自包含的记录（请求 id、路径、状态、耗时、错误），而非自由格式的字符串 — 这让日志可 grep，并适合 evlog 自带的文件排水管道。错误处理器在两处接线（oRPC 处理器的 `onError` 拦截器和 Hono 的 `app.onError`），因此 procedure 内部抛出的错误和中间件中抛出的错误都恰好被记录一次。

### Drizzle ORM

所有数据库访问都经过 Drizzle 的查询构建器。schema 位于 `packages/db/src/schema/*.ts`，并从 `index.ts` 以命名空间对象形式 barrel 导出（drizzle 需要整个 schema 用于关系）。每个表模块定义列、索引和关系。

**仓储模式**是访问纪律：每个聚合在 `packages/db/src/repositories/` 中都有一个 `createXStore(db, …)` 工厂，返回一个带类型的 store 对象（`agent-store.ts`、`session-store.ts`、`message-store.ts`、`usage-store.ts` 等）。该工厂闭包捕获 `db` 和 `SecretBox`（当聚合有加密列时），并暴露带类型的方法 — `findByTokenHash`、`create`、`listByUser`、`update`、`delete` 等。

`Db` 类型与驱动无关（`PgDatabase<PgQueryResultHKT, typeof schema>`），可由 `node-postgres`（生产）、Neon serverless 和 PGlite（测试）满足 — 因此同一份仓储代码可在三者上运行。

组合根（`services.ts:186` `buildStores`）实例化每个 store 并将它们交给 `buildServices`，后者将它们打包进贯穿每个 procedure `Context` 的 `services.stores` 集合。

**禁用原生 SQL**。`scripts/check-no-raw-sql.js` 是一个 pre-commit 守卫（在 `lefthook.yml:20` 中接线），它扫描 `packages/db/` 下已暂存的 `.ts`/`.tsx` 文件中的 `sql\`…\`` 标签模板 — drizzle 的原生 SQL 逃生口。任何匹配都会让提交失败，并给出一条指向构建器 API（`db.insert().values()`、`db.update().set().where()`、`db.select().from().where()`、`.onConflictDoUpdate()`）的消息。注释行会被跳过；`sql.raw()` / `sql.identifier()`（无反引号）不受影响。这让 DB 层完全基于构建器，这正是使其按构造即可驱动可移植且防 SQL 注入的原因。

## 设计理由

- **scrypt + AES-256-GCM，单一载荷格式** — scrypt 使从泄露的密文暴力破解密钥代价高昂；GCM 的 auth tag 在 `final()` 处检测篡改和错误密钥尝试。单一载荷格式（`ivHex:tagHex:dataHex`）意味着每个加密列都是可互换且自描述的。
- **每个 isolate 记忆 SecretBox** — `scryptSync` 被刻意设计得很慢；每进程派生一次并复用，让加密不处于热路径上。
- **每次加密随机 IV** — 密钥派生上的固定盐值是安全的，因为 IV 每次都是全新的，因此相同明文永不重复密文。
- **oRPC 带类型契约** — 一个 `AppRouter` 类型从服务端路由器 → 带类型客户端 → TanStack Query 工具 → React 组件流转。新增 procedure 或变更输入在整个 monorepo 中都是编译错误，而非运行时发现。
- **以 procedure 构造器作为认证接缝** — 认证策略是一条中间件链（`publicProcedure` → `userProcedure` → `adminProcedure`），而非散落的 `if (!user)` 检查。每个 procedure 通过其构造器声明自己的门禁；门禁不会被遗忘。
- **实时封禁重读** — `requireActiveUser` 每次请求都读取用户记录而非信任 JWT 声明，因此封禁用户会在其下次调用时生效，无需令牌黑名单或等待 access token 过期。
- **流式路径跳过日志中间件** — 日志中间件会缓冲响应体，这与流式响应不兼容。一个显式白名单（`STREAMING_PATHS`）在保持对请求/响应 RPC 日志覆盖的同时，让流不受影响。
- **与驱动无关的仓储类型** — 一个 `Db` 类型，三个驱动（node-postgres、Neon、PGlite）。同一份仓储代码在生产中、Workers 上以及使用内存 PGlite 的测试中运行。
- **以禁用原生 SQL 作为提交门禁** — 保持 DB 层仅用构建器正是使其驱动可移植（无方言特定 SQL）且防注入的原因。在 pre-commit 中强制执行（而非仅靠 review）意味着该约束不会在繁忙日子里溜过。
- **组合根优于服务定位器** — `buildServices` 在启动时显式接线每个依赖；procedure 通过 `Context` 接收它们。无全局变量，无 `require` 时查找，每个 store 在测试中都可 mock。

## 配置

| 配置项 | 位置 | 默认值 | 说明 |
|------|----------|---------|-------|
| 加密算法 | `packages/agent/src/crypto/secret-box.ts:8` | `aes-256-gcm` | `ALGORITHM` |
| IV 长度 | `packages/agent/src/crypto/secret-box.ts:9` | 12 字节 | `IV_LENGTH` — 每次加密随机化 |
| 密钥长度 | `packages/agent/src/crypto/secret-box.ts:10` | 32 字节 | `KEY_LENGTH` — scrypt 输出 |
| scrypt 盐值 | `packages/agent/src/crypto/secret-box.ts:11` | `better-agent.secret-box.v1` | `SALT` — 固定；安全性来自随机 IV |
| 凭证密钥 | `CREDENTIALS_SECRET` 环境变量 | 必需 | 必须 32+ 字符；喂给 `scryptSync` |
| Authz 缓存 TTL | `packages/api/src/index.ts:63` | 60_000 ms | `AUTHZ_TTL_MS` — 邀请门禁缓存 |
| oRPC 错误拦截器 | `apps/server/src/app.ts:52` | `log.error({ error })` | 接线在 RPC + OpenAPI 处理器上 |
| 流式路径白名单 | `apps/server/src/app.ts:25` | `sessions/prompt`, `userSessions/prompt`, `/bridge/…/stream` | 跳过 evlog 中间件 |
| 心跳（bridge SSE） | `apps/server/src/app.ts:42` | 15_000 ms | `HEARTBEAT_MS` — 保持空闲代理存活 |
| CORS 来源 | `CORS_ORIGIN` 环境变量 | 必需 | 在 `onError` 中重新应用，使错误响应保持可读 |
| 原生 SQL 模式 | `scripts/check-no-raw-sql.js:21` | `/\bsql\s*\`/` | 匹配 `sql\`…\`` 标签模板 |
| 禁用原生 SQL 范围 | `scripts/check-no-raw-sql.js:62` | `packages/db/` 的 `.ts`/`.tsx` | 仅已暂存文件 |
| pre-commit 作业 | `lefthook.yml:4` | 7 个并行作业 | format、lint、file-rules、no-raw-sql、eslint、package-json、tailwind |
| pre-push 门禁 | `lefthook.yml:72` | `pnpm check-types` | 推送前全 monorepo 类型检查 |
| 提交信息模式 | `lefthook.yml:44` | 约定式提交 | `type(scope): description`，≤72 字符 |
