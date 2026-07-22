# Cloudflare Workers 时代遗留审计（Docker 部署下）

> 审计日期：2026-07-22 · 分支：dev · 范围：`apps/server`、`packages/api`、`packages/agent`、`packages/db`
> 背景：server 已从 Cloudflare Workers 完全迁移到 Docker Compose（单实例 Node + Postgres + Redis）。本报告系统排查为 Workers 硬限制做的保守设计/兼容代码，判断哪些在 Docker 下已过时。

---

## 摘要

**总体判断：遗留不多，而且最影响用户的那一类（长输出被截断）此前已经修过。** 剩下的绝大部分是**死代码 + 过时注释**，只有一处是真正的运行时正确性隐患。不值得为它单开一个大重构，但值得顺手做**一轮小清理**（删死配置/死代码/纠正误导性注释），外加**一个正确性修复**。

分级统计：

- **影响用户/正确性：1 处**（session lock 无心跳续期 → 长 turn 下并发窗口，Docker 让长 turn 成为常态）。
- **影响性能：0 处需改**（Workers 时代的 HTTP 轮询式 Upstash 存储在 Docker 下根本不会被选中，已被 Redis pub/sub 路径取代；性能已经是好的那条路）。
- **仅清理（死代码/死配置/死依赖）：3 处**（根 `wrangler.toml`、Service Binding 管线、Upstash REST 存储 + `@upstash/redis` 依赖）。
- **纯注释/文档过时：7+ 处**（多个文件仍在讲 Workers/isolate/worker.ts/Workers AI 假设）。

**最该先改的 Top 5：**

1. **`redis-session-lock.ts` 的 `LOCK_TTL_MS=300_000` 无心跳续期**（正确性）——Docker 下 turn 真能跑超过 5 分钟，命中代码里自己写明的"锁自动过期→第二个并发 prompt 被放行"窗口。加 PEXPIRE 心跳。
2. **删除根 `wrangler.toml`**（死配置 + 误导）——`main` 指向已被删除的 `apps/server/src/worker.ts`，且没有任何 workflow 引用它。
3. **删除 Upstash REST 存储 + `@upstash/redis` 依赖**（死代码/依赖）——纯为跨 isolate 的 HTTP 轮询而生，Docker 下永不被选中。
4. **删除 Service Binding 管线**（死代码）——`authz-client.ts` / `mcp.ts` / `services.ts` 的 binding 分支在 Node 入口永远传 `undefined`，不可达。
5. **纠正一批 Workers 味的注释**（误导）——`bridge-ws.ts`、`vnc-proxy.ts`、`mcp.ts`、`embedding-client.ts`、`services.ts`、`password.ts`、`memory-ports.ts` 里对 worker.ts / isolate / Workers AI 的引用已与现实不符。

---

## (a) 真正的遗留问题（需要改）

### A1. 【正确性】session lock 固定 TTL、无心跳续期
- **文件**：`apps/server/src/redis-session-lock.ts:8-18`（注释与 `LOCK_TTL_MS = 300_000`）。
- **是什么**：会话锁用 `SET NX PX 300000` 获取，5 分钟 TTL，token 守护释放。代码注释里 "Known limitation" 已明写：TTL 固定、不在 turn 中途续期；跑得比 TTL 久的合法 turn 会让锁自动过期，从而放行同一 session 的第二个并发 prompt。
- **为什么是 Workers 遗留**：在 Workers 上，单请求有 CPU/时长上限，一个 turn 不被期望跑到数分钟，所以"固定 5 分钟 TTL 足够长"是合理假设。迁到 Docker 后，多步工具循环的一个 turn **真实可达数分钟甚至更久**（Node 无单请求时长限制），恰好落进注释里描述的并发窗口。
- **Docker 下现状影响**：潜在正确性 bug（不是死代码）。表现为：一个长 turn 进行中，锁到期，用户/客户端再发一条同 session 的 prompt 被错误放行，两个 turn 并发跑同一会话。token 守护只防锁被误删，不防这个并发窗口。
- **建议改法**：turn 在飞行期间起一个定时器周期性 `PEXPIRE`（心跳续期）锁 key；turn 结束/release 时停掉。这正是注释末尾自己建议的方案。
- **风险/工作量**：低-中。改动集中在这一个文件加调用方的 turn 生命周期钩子；需注意心跳定时器要在 turn 异常退出时也被清理（否则锁永不释放，直到进程死）。~0.5 天含测试。

---

## (b) 看着像遗留、但需要改成删除的死代码/死配置/死依赖

> 这些不是"合理保留"，而是 Workers 时代的产物在 Docker 下已**不可达**，属于安全删除的清理项。

### B1. 根 `wrangler.toml` 已完全失效
- **文件**：仓库根 `wrangler.toml`（整份）。
- **是什么**：`main = "apps/server/src/worker.ts"`、`compatibility_flags = ["nodejs_compat", ...]`，声明 AUTHZ / MCP 两个 service binding、R2 `UPLOADS` binding、以及一段被注释掉的 Hyperdrive 配置。
- **证据**：`apps/server/src/worker.ts` **已不存在**（`git log` 显示提交 `e4fb484 chore(server): drop dead Cloudflare Workers entry from the Node deployment` 删掉了它）。`.github/workflows/deploy-test.yml` / `deploy-prod.yml` 只从 `apps/mcp`、`apps/finance-mcp`、`apps/weread-mcp`、`apps/authz` 各自目录 `wrangler deploy`，**没有任何 workflow 引用根 `wrangler.toml`**。
- **Docker 下现状影响**：死配置 + 误导。`main` 指向不存在的文件，任何人手动 `wrangler deploy` 都会失败；里面的 binding/Hyperdrive 叙事会让读者以为 server 还在 Workers 上跑。
- **建议改法**：直接删除根 `wrangler.toml`。
- **风险/工作量**：极低。先 `grep` 全仓确认无引用（已确认），删即可。

### B2. Service Binding 管线在 Node 入口不可达
- **文件**：
  - `apps/server/src/authz-client.ts:9-13`（`ServiceBinding` interface）、`:31-33`（`binding ? binding.fetch(...) : fetch(url)` 分支）；
  - `apps/server/src/mcp.ts:12-19`（`INTERNAL_MCP_HOST_MARKER` + `ServiceBinding`）及 `buildMcpResolver` 的 `mcpBinding` 路由；
  - `apps/server/src/services.ts:38, 151-152, 185, 250-252`（`authzBinding` / `mcpBinding` 参数穿透）；
  - `apps/server/src/index.ts:31` `buildServices(db, undefined, uploads)`。
- **是什么**：同账号 Worker 之间公网 URL 互相 fetch 会被 CF 拦（error 1042），所以 authz/自建 MCP 的调用在 Workers 上走 service binding，在 Node 上回退成普通 `fetch(AUTHZ_URL)` / 公网 URL。
- **证据**：唯一的生产入口 `index.ts` 调 `buildServices(db, undefined, uploads)`——第二个参数 `authzBinding` 永远是 `undefined`，`mcpBinding` 走默认也是 `undefined`。两条 binding 分支在 Docker 部署里**永不进入**。
- **Docker 下现状影响**：死代码（非 bug，fetch 回退路径就是实际生效路径）。
- **建议改法**：删掉 `ServiceBinding` 类型与 binding 分支，`authorize/redeem` 恒走 `fetch(AUTHZ_URL)`，MCP 恒走公网 URL；顺带移除 `services.ts` 的 `authzBinding/mcpBinding` 参数和 `INTERNAL_MCP_HOST_MARKER`。
- **风险/工作量**：低-中。要保留并确认 fetch 回退路径本身完好（它现在就是唯一路径），只是把"二选一"压平成"一条"。~0.5 天。

### B3. Upstash REST 存储 + `@upstash/redis` 依赖已冗余
- **文件**：`apps/server/src/upstash-pending-store.ts`（整份）、`apps/server/src/upstash-cancellation.ts`（整份）、`apps/server/src/services-infra.ts:30-33, 70-73`（`upstashRedis()` 选择器）、`:77-83`（pending store 的 upstash 分支）、`:90-96`（cancellation 的 upstash 分支）、`apps/server/package.json:25`（`@upstash/redis` 依赖）。
- **是什么**：pending-tool-call store 与 cancellation registry 的三层选择 `Upstash > node-redis > in-memory`。Upstash 版是 **REST-over-HTTP 轮询**（`POLL_INTERVAL_MS = 250` / `750`）。
- **为什么是 Workers 遗留**：Upstash REST 轮询存在的唯一理由是"跨 Workers isolate 协调、且 Workers 无法用长连接 pub/sub"（见两文件的顶部注释和 `services-infra.ts:70` 注释）。
- **证据**：`deploy/compose/docker-compose.yml` 与 `.env.example` **没有** `UPSTASH_REDIS_REST_URL/TOKEN`，所以 `upstashRedis()` 恒返回 `null`，Upstash 分支永不被选中。而实际生效的 node-redis 路径（`redis-pending-store.ts`、`redis-cancellation.ts`）用的是 **真正的 Redis pub/sub**（`subscribe`/`publish`，事件驱动、无轮询）——严格优于 HTTP 轮询。
- **Docker 下现状影响**：死代码 + 一个用不到的依赖。
- **建议改法**：删掉两个 `upstash-*.ts`、`services-infra.ts` 里的 `upstashRedis()` 与两处 upstash 分支（保留 `REDIS_URL ? redis : in-memory`），移除 `@upstash/redis` 依赖。
- **风险/工作量**：低。注意保留 node-redis 路径（横向扩容仍需要）与 in-memory 回退（测试/无 REDIS_URL）。~0.5 天。

---

## (c) 看着像遗留、但应当保留（合理设计，勿动）

- **Redis 支持本身**（`redis-*.ts` 全套、`REDIS_URL` 分支）：横向扩容仍需要；且 pub/sub 实现本身高效，不是 Workers 味的轮询。**保留。**
- **三个 MCP（mcp/finance-mcp/weread-mcp）+ authz 的 Workers 双部署**（各自 `apps/*/wrangler.toml`、`apps/*/src/worker.ts`、`deploy-test.yml`）：有意保留的双部署，**不算遗留**。
- **`s3-bucket.ts` + `aws4fetch` 依赖**：R2 经其 S3 兼容 API 访问（`docker-compose.yml` 设了 `S3_*`），是生产实际路径，**保留**。注释里"same bucket the Workers deployment reaches through its native binding"是历史对照，可留可删。
- **`services.ts` 的 `commandBus`（in-process 发布订阅）与 `computerReplayGuard`（in-memory 防重放）**：注释已写明"故意单进程/in-memory，单实例 Docker 一个进程看到全部"，是**正确的单实例选择**，不是遗留。
- **`packages/api/src/bridge/ownership.ts:11` `MAX_CACHED_OWNERS = 10_000` 的 in-memory owner 缓存**：owner 一旦创建不可变，进程内缓存是正当热路径优化；横向扩容时也只是各进程各自缓存、无正确性问题。**保留。**
- **`persist-retry.ts:42-49` `maybeUnref`**：`unref` 在 Node 上真实有用（防后台 flush 定时器把进程吊住）。注释提到 Workers 只是解释为何要做存在性判断，**代码在 Node 下是对的，保留**（注释可微调，见 C 类）。
- **`context.ts:123-138` `extractWaitUntil` + `turn-channel.ts` 的 detached pump**：`waitUntil` 在 Node 下回退成 fire-and-forget，功能正确（Node 事件循环会让游离 promise 跑完）。"turn 独立于 SSE observer 跑完、客户端断开不杀 turn"的架构在 Docker 下**依然有价值**，不是遗留。仅注释是 Workers 味的（见 C 类）。

---

## (c') 纯注释/文档过时（误导，非功能问题）

这些不改功能，但注释在讲已经不成立的 Workers 假设，会误导后来者。建议随手改：

| 文件:行 | 过时内容 | 现实 |
|---|---|---|
| `apps/server/src/bridge-ws.ts:24` | "app.ts is also used by the Cloudflare Workers entry (worker.ts), which can't support long-lived WebSockets" | worker.ts 已删；把 WS 移出 buildApp 的真实理由现在是"保持 transport-agnostic + 复用同一个 upgradeWebSocket 实例"，Workers 那半句已失效 |
| `apps/server/src/vnc-proxy.ts:236-238` | "Only wired on the Node (Docker) deployment — ... unsupported on the Workers entry, which never calls this" | 已无 Workers 入口 |
| `apps/server/src/mcp.ts:53` | per-call 连接"avoid stale-session state across Worker isolates" | 现在只是实现简单，无 isolate |
| `apps/server/src/embedding-client.ts:4-16` 与 `services.ts:87` | "Memory embeddings via Workers AI (decision D1)" | 实际调 SiliconFlow 外部 API（embedding-client 注释已自我修正为 "despite decision D1 ... NOT on-edge"，但 services.ts:87 仍写 "Workers AI"） |
| `packages/agent/src/memory-ports.ts:36` | "Workers AI path decision D1" | 同上，已非 Workers AI |
| `apps/server/src/password.ts:24-33` | dummy hash 懒加载因"Workers forbid generating random values in global scope" | Node 无此限制；懒加载无害可留，但理由已不成立 |
| `apps/server/src/services-infra.ts:30-37` | "Upstash (Workers, cross-isolate) > ..."、"memoize the secret box per isolate" | 无 isolate；随 B3 一起清 |

---

## 关于保守大小/超时/数量上限的逐项核查

> 结论：MAX_EVENT_BYTES / MAX_INPUT_CHARS 这两个最典型的已修；其余的多数不是 Workers 约束，只有 1-2 个值得考虑放宽。

- **`MAX_EVENT_BYTES`**（`packages/api/src/routers/bridge-size-limits.ts` + `apps/bridge-cli/src/truncate-status-shrink.ts`）：**已从 32_768 提到 262_144（256 KiB）**，注释明确说明是 Workers 时代保守值、Docker 下放宽。**已修，无需动。**
- **`MAX_INPUT_CHARS`**（同文件）：**已从 8192 提到 100_000**。**已修，无需动。**
- **`MAX_UPLOAD_BYTES = 8 * 1024 * 1024`（8 MB）**（`packages/api/src/attachments.ts:5`）：聊天图片上传上限。Workers 有请求体大小/128MB 内存压力，会倾向小上限；Docker 下无此限制。**候选放宽**（影响用户：无法上传 >8MB 图片）。风险低，但需同步确认 S3 直传/内存缓冲不会因大文件 OOM（单实例内存受限，见 compose 注释）。优先级低。建议值：按产品定，16-32 MB 合理。
- **`KNOWLEDGE_PART_SIZE = 8MB`**（`packages/agent/src/knowledge-ports.ts:15`）、**`MAX_PART_NUMBER = 10_000`**（`knowledge-content.ts:21` / `knowledge-base.ts:22`）：这是 **S3 multipart 协议约束**（分片下限 5MB、分片数上限 10000），**不是 Workers 遗留**，勿动。
- **`MAX_WINDOW = 500`（relay 重放窗口）**（`packages/agent/src/bridge/relay-store.ts:29`）：重放缓冲区大小。其内存成本现由 `MAX_EVENT_BYTES` 决定（bridge-size-limits 注释已核算最坏 500×256KiB）。可放宽但收益有限，**低优先，暂不改**。
- **`AUTHZ_TTL_MS = 60_000`、`LOCK_TTL_MS = 300_000`**：前者是缓存 TTL，合理；后者见 A1（不是值太小，而是缺心跳续期）。
- **各类外部 API 超时**（`MCP_TIMEOUT_MS=45s`、`COMPOSIO_TIMEOUT_MS=12s`、`REQUEST_TIMEOUT_MS=15s` 等）：是外部依赖超时，与 Workers CPU 限制无关，**非遗留**。

---

## 建议处理顺序

1. **A1 session-lock 心跳续期**（唯一正确性项，Docker 下更易触发）——先做。
2. **B1 删根 `wrangler.toml`**（一分钟，消除误导 + 防误 deploy）。
3. **B3 删 Upstash 存储 + `@upstash/redis` 依赖**（连带 `services-infra.ts` 的选择器一起收）。
4. **B2 压平 Service Binding 管线**（authz-client / mcp / services / 顺带 INTERNAL_MCP_HOST_MARKER）。
5. **C' 注释清理**（可与 2-4 合并到同一个 "chore: drop workers-era leftovers" PR 里顺手做）。
6. **（可选）`MAX_UPLOAD_BYTES` 放宽** —— 需产品确认目标值 + 确认单实例内存安全后再动。

B1-B4 + C' 都属低风险清理，适合一个 PR 一次做完；A1 单独一个正确性 PR。整体工作量约 1-2 天。
