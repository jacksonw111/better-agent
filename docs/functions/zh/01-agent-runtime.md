# AI Agent 运行时

会话运行时将一条用户提示转化为一次或多次模型轮次——向客户端流式传输输出、将每个增量持久化到数据库、驱动多步工具循环、压缩冗长的历史记录、重试瞬时故障，并响应取消操作——所有这些都隐藏在单个 `runTurn` 异步生成器背后。

## 架构

运行时围绕依赖注入组装。`createSessionRuntime(deps)`（`runtime.ts:265`）返回一个 `SessionRuntime`，其唯一方法是：

```ts
interface SessionRuntime {
  runTurn(input: RunTurnInput): AsyncGenerator<RunEvent, Message>;
}
```

`SessionRuntimeDeps`（`runtime.ts:50`）携带运行时所需的每个存储和协作者——没有全局变量，没有服务定位器：

```ts
interface SessionRuntimeDeps {
  agentStore: AgentStore;
  attachmentStore?: AttachmentStore;
  cancellation?: CancellationRegistry;
  clock?: () => Date;
  messageStore: MessageStore;
  modelCacheStore: ModelCacheStore;
  modelFactory: ModelFactory;
  providerCatalogStore: ProviderCatalogStore;
  sessionLock: SessionLock;
  sessionStore: SessionStore;
  sleep?: (ms: number) => Promise<void>;
  summarizer: Summarizer;
  titler?: Titler;
  usageRecordStore?: UsageRecordStore; // optional dual-write target (Task 3)
}
```

这使得运行时完全可以用内存中的 fake 进行测试，并让服务器在不触碰轮次逻辑的情况下替换为基于 Redis/Upstash 的锁、取消和 pending-tool 存储实现。

### `runTurn` 流程

`runTurn`（`runtime.ts:267`）用三个横切关注点包装 `executeTurn`（`runtime.ts:216`）：

1. **会话锁** — 在做任何事之前 `acquire` 锁；若被持有则抛出 `SessionBusyError`。`release` 在 `finally` 中执行。
2. **取消** — 将调用方的 `AbortSignal` 与一个新的 controller 合并，然后 `register` 它，以便带外 `cancel(sessionId)` 可以中止进行中的轮次。`unregister` 在 `finally` 中执行。
3. **轮次本身** — `executeTurn` 运行以下步骤并返回最终的 `Message`。

`executeTurn` 的执行流程：

1. **加载上下文**（`turn-messages.ts:57` `loadContext`）— 获取 `Session` 及其绑定的 `AgentConfig`。
2. **持久化用户轮次**（`turn-messages.ts:92` `persistUserTurn`）— 创建一条 `user` 消息（状态为 `complete`），包含一个 `text` part，以及任何附件对应的 `file` part。
3. **启动标题生成**（`titler.ts:10` `maybeTitle`）— 一个 fire-and-forget promise；参见[自动标题](#自动标题)。
4. **准备消息**（`runtime.ts:189` `prepareMessages`）— 构建 `ModelMessage[]`（如需则进行压缩）并应用提供商的缓存策略。
5. **准备工具绑定**（`runtime.ts:204` `prepareToolBinding`）— 可能进入延迟绑定模式（参见 [Deferred Tool Binding]）。
6. **构建助手上下文**（`runtime-support.ts:13` `buildAssistantCtx`）— 创建 `assistant` 消息行（状态为 `streaming`）和 `DrainCtx`。
7. **流式传输**（`runtime.ts:241` `streamAssistant`）— 带重试地运行模型，排空每个 chunk。
8. **收尾**（`runtime-finalize.ts:89` `finalizeAssistant`）— 为用量定价、双写到 `usage_records`、设置最终状态/错误、发出 `done`/`error`。
9. **结算标题**（`runtime-support.ts:39` `settleTitleEvent`）— 等待 title promise 并发出 `title` 事件。

## 关键文件

| 文件 | 职责 |
|------|----------------|
| `runtime.ts` | `createSessionRuntime`、`runTurn`、`executeTurn`、DI 容器 |
| `runtime-drain.ts` | `drainStream` — chunk 分发循环 |
| `runtime-finalize.ts` | `finalizeAssistant` — 定价、`usage_records` 双写、状态、终止事件 |
| `runtime-support.ts` | `buildAssistantCtx`、`settleTitleEvent` |
| `part-buffer.ts` | `createPartBuffer` — 节流的增量持久化 |
| `compaction.ts` | 边界选择、摘要 prompt、`compactSession` |
| `token-estimate.ts` | 廉价的基于字符的估算、80% 溢出检查 |
| `doom-loop.ts` | 连续相同调用守卫 |
| `retry-helpers.ts` | 退避算法、`shouldRetryAttempt` |
| `error-classify.ts` | `classifyError` → retryable / fatal / content-filter / aborted |
| `cancellation.ts` | `CancellationRegistry` 接口 + 内存实现 |
| `session-lock.ts` | `SessionLock` 接口 + 内存实现、`SessionBusyError` |
| `titler.ts` / `model-titler.ts` | 首轮标题生成 |
| `model-summarizer.ts` | 用于压缩的基于 LLM 的 `Summarizer` |
| `turn-messages.ts` | `buildTurnMessages`、`persistUserTurn`、`loadContext` |
| `to-model-messages.ts` | 历史 → AI SDK `ModelMessage[]` |
| `stream-mapping.ts` | 将 AI SDK usage/finishReason 映射为内部类型 |
| `dynamic-context.ts` | 追加到系统 prompt 的天级精度日期 |
| `events.ts` | `RunEvent` 可辨识联合类型 |
| `types.ts` | `Session`、`Message`、`MessagePart`、状态枚举 |
| `apps/server/src/redis-session-lock.ts` | Redis `SET NX PX` 锁（5 分钟 TTL） |
| `apps/server/src/redis-cancellation.ts` | Redis pub/sub 取消 |
| `apps/server/src/upstash-cancellation.ts` | Upstash 基于轮询的取消 |

（所有路径位于 `packages/agent/src/session/` 下，除非有前缀。）

## 数据流

### 流式传输：PartBuffer + drainStream

模型的 `fullStream` 由 `drainStream`（`runtime-drain.ts:87`）消费，它对 chunk 类型进行模式匹配：

| Chunk | 动作 | 产出的事件 |
|-------|--------|---------------|
| `text-delta` | `bufs.text.append(chunk.text)` | `text-delta` |
| `reasoning-delta` | `bufs.reasoning.append(chunk.text)` | `reasoning-delta` |
| `tool-call` | 追加一个 `tool-call` part，标记 `emittedOutput` | `tool-call` |
| `tool-result` / `tool-error` | 追加一个 `tool-result` part | `tool-result` |
| `finish-step` | `bufs.*.finishStep()`（关闭 part，为下一步重置缓冲区） | `step-finish` |
| `finish` | 将 usage + finishReason 记录进 `state` | — |
| `error` / `abort` | 设置 `state.status` | — |

`PartBuffer`（`part-buffer.ts`）是持久化机制。在**首个** delta 时它插入一个 part 行（状态为 `streaming`）；此后写入频率最多为每 `PERSIST_THROTTLE_MS`（250ms，`part-buffer.ts:4`）一次；`flush` 完成状态收尾。因此流式中途崩溃会留下部分可持久化的文本，而不是丢失整条消息。`finishStep`（`part-buffer.ts:78`）关闭当前 part 并重置缓冲区，使多步轮次在每步产生一个文本 part。

`emittedOutput`（`retry-helpers.ts:7`）是无部分抛出守卫：一旦任何 delta 已到达客户端，后续错误**不会**被重试（参见 [重试与退避](#重试与退避)）。

### 收尾与用量记录

流式稳定后，`finalizeAssistant`（`runtime-finalize.ts:89`）做四件事：

1. **定价** — `withCost`（`runtime-finalize.ts:22`）查找模型条目并调用 `priceUsage` 获取美元金额；转换为整数 `costCents`（`runtime-finalize.ts:34`）。
2. **持久化消息** — `updateMessage` 写入最终的 `status`、`usage`、`finishReason` 和 `error`。
3. **双写用量** — 当 `session.userId !== null` 时，`recordChatUsage`（`runtime-finalize.ts:75`）插入一条 `usage_records` 快照（tokens、cost、provider、model、去重键 `chat:<assistantId>`）。这是**尽力而为**：插入失败会被记录并吞掉，永远不会让轮次失败——上面旧的 `messages.usage` 写入已经成功了。
4. **发出** — `done`（含 usage + finishReason）或 `error`，并将会话状态翻转为 `active`/`error`。

### 压缩

仅在估算的 token 数超过模型上下文限制的 80% 时，才在 `buildTurnMessages`（`turn-messages.ts:121`）内部触发（`token-estimate.ts:5` `COMPACT_THRESHOLD = 0.8`）。估算刻意保持廉价：chars/4 + 每条消息 4 token 开销（`token-estimate.ts:14`）。

`compactSession`（`compaction.ts:50`）：

1. `selectCompactionBoundary`（`compaction.ts:17`）— 保留最后 `KEEP_RECENT_MESSAGES`（6）条消息；边界是它们之前那条消息的 seq。当历史较短时返回 `null`（不压缩）。
2. 计算**增量**切片：`seq > session.compactedThroughSeq` 且 `seq <= boundary` 的消息。已经摘要过的内容不会被重新摘要。
3. `buildSummaryPrompt`（`compaction.ts:35`）将先前摘要（如有）加上渲染后的消息折叠为一个 prompt。
4. 注入的 `Summarizer`（`model-summarizer.ts:8`）使用代理自身的 provider/model 调用 `generateText`，并附带压缩系统 prompt。
5. `sessionStore.setSummary(sessionId, summary, boundary)` 持久化新摘要并推进 `compactedThroughSeq` **水位线**。

在下一轮，`toModelMessages`（`to-model-messages.ts:178`）发现 `summary !== null`，将其作为 `system` 消息前置，并**过滤掉**每条 `seq <= compactedThroughSeq` 的消息——因此已摘要的历史永远不会被发送两次。

### 多步工具循环

AI SDK 驱动该循环。`streamText` 调用时传入 `stopWhen: stepCountIs(DEFAULT_MAX_STEPS)`（`runtime.ts:129`，`DEFAULT_MAX_STEPS = 50` 在 `runtime.ts:48`）。每个 `tool-call` → 执行 → `tool-result` 循环是一“步”；SDK 会持续运行，直到模型停止调用工具或达到 50 步。

工具执行经过 `buildTools`（`registry.ts:10`），它用三个关注点包装每个 `ToolDef.execute`：doom-loop 守卫、输出截断，以及 error→throw 转换（使模型把工具失败视为 `tool-error` chunk）。

### Doom-Loop 守卫

`createDoomLoopGuard`（`doom-loop.ts:15`）跟踪上一次的 `(toolName, args)` 签名。在**第 3 次**连续相同调用时（`DOOM_LOOP_THRESHOLD = 3`，`doom-loop.ts:1`），`buildTools` 短路并返回 `DOOM_LOOP_MESSAGE` 而不执行（`registry.ts:36`）。这把模型从病态重复中轻推出来，而不会让轮次失败。

### 重试与退避

`streamAssistant`（`runtime.ts:151`）循环最多 `MAX_LLM_ATTEMPTS` 次（3，`retry-helpers.ts:3`）。`shouldRetryAttempt`（`retry-helpers.ts:34`）仅在以下条件全部满足时为真：

- `state.status === "error"`，
- **未发出过输出**（`!emittedOutput`）— 无部分抛出规则，
- 错误归类为 `retryable`，
- 还有剩余尝试次数，且
- 轮次未被中止。

退避是指数级的：`backoffMs(attempt) = BASE_BACKOFF_MS * 2^(attempt-1)` → 500ms、1000ms、2000ms（`retry-helpers.ts:21`）。`classifyError`（`error-classify.ts:28`）将 HTTP 408/409/425/429/500/502/503/504、`isRetryable === true` 以及已知瞬时消息（timeout、overloaded、rate limit）标记为 retryable；内容过滤错误及其他一切为 fatal；中止是独立的一类。

### 取消

`CancellationRegistry` 接口（`cancellation.ts:1`）有 `register` / `unregister` / `cancel`。`runTurn` 注册轮次的 `AbortController`，合并后的 `abortSignal` 向下流入 `streamText` 并进入每个工具的 `ToolContext`。

存在两种分布式实现，因为进程内注册表无法跨服务器实例或 Cloudflare 隔离区触达：

- **Redis pub/sub**（`apps/server/src/redis-cancellation.ts`）— `cancel` 在 `session-cancel` 上发布；专门的订阅者中止匹配的 controller。
- **Upstash 轮询**（`apps/server/src/upstash-cancellation.ts`）— `cancel` SET 一个标志（60 秒 TTL）；每个进行中的轮次每 750ms 轮询一次 GET。用于长生命周期订阅者不可行的 Workers 场景。

### 会话锁

`SessionLock`（`session-lock.ts:1`）是 `acquire(sessionId): Promise<boolean>` / `release`。内存实现（`session-lock.ts:18`）使用 `Set`。Redis 实现（`apps/server/src/redis-session-lock.ts:26`）执行 `SET key token PX 300000 NX`（5 分钟 TTL），并通过受 owner token 守卫的 Lua 比较并删除脚本释放——因此一个超过其 TTL 的轮次永远不会删除后继者的锁。

### 自动标题

`maybeTitle`（`titler.ts:10`）**仅在首轮**（`session.title == null`）生成标题，若未接入 titler 则返回 `null`，并附带 `.catch(() => null)`，使 titler 失败永远不会破坏轮次。具体的 titler（`model-titler.ts:8`）在代理自身的模型上调用 `generateText`，使用一个最多 6 个词的系统 prompt。它是 fire-and-forget：`executeTurn` 在流式传输前不会等待它——它只在最后的 `settleTitleEvent` 中被 await，该方法持久化标题并发出 `title` 事件。

### 会话持久化

两张表支撑一个会话（`packages/db/src/schema/sessions.ts`）：

- **`messages`** — 每条消息一行，带有按会话单调递增的 `seq`（唯一索引 `messages_session_seq`）。`seq` 由 `nextSeq`（`message-store.ts:46`）在事务内于应用中分配，该事务读取现有 seq 并取 max+1。
- **`message_parts`** — 每个 part（text/reasoning/tool-call/tool-result/file）一行，按消息单调递增的 `seq`（唯一索引 `message_parts_message_seq`）。

`type` 和 `content` 作为独立列存储；数据库无法表达它们的对应关系，因此 repository 在边界处断言形状（`message-store.ts:33`）。`MessageStore`（`message-store.ts:117`）与驱动无关——其 `Db` 类型（`message-store.ts:9`）可同时由 `node-postgres`（`packages/db/src/node-db.ts`）和 Neon serverless（`packages/db/src/neon-db.ts`）以及测试中的 PGlite 满足。

## 设计理由

- **依赖注入优先于全局变量** — 每个存储和协作者都是构造参数。这保持运行时纯净，使测试中的 fake 轻而易举，并让服务器按部署目标选择 Redis、Upstash 或内存实现，而无需在轮次逻辑中分支。
- **250ms 节流，而非每个 delta** — 每个 token 写入一个 part 行会压垮 Postgres。节流把写入限制在 ~4 次/秒，同时仍让轮询客户端可见进展，并在四分之一秒内持久化。
- **增量压缩水位线** — `compactedThroughSeq` 意味着 summarizer 只折叠自上次压缩以来的*新*切片，使压缩成本与增长成正比，而非与历史长度成正比。
- **无部分抛出重试** — 在客户端已看到 token 后重试会重复输出并损坏已持久化的消息。一旦 `emittedOutput` 为 true，错误就成立。
- **Doom-loop 作为提示而非失败** — 返回纠正性字符串保持轮次存活，让模型自我修正，而不是让整个轮次硬性失败。
- **Token 守卫的锁释放** — 固定 TTL 可能让长轮次的锁过期；Lua 释放脚本确保只有当前 owner 能删除 key，即使在该窗口内也能防止损坏。

## 配置

| 旋钮 | 位置 | 默认值 | 备注 |
|------|----------|---------|-------|
| 每轮最大步数 | `runtime.ts:48` | 50 | `DEFAULT_MAX_STEPS`，传入 `stepCountIs` |
| Part 持久化节流 | `part-buffer.ts:4` | 250 ms | `PERSIST_THROTTLE_MS` |
| 压缩阈值 | `token-estimate.ts:5` | 0.8 | 上下文限制的 `COMPACT_THRESHOLD` |
| 压缩后保留的消息数 | `compaction.ts:5` | 6 | `KEEP_RECENT_MESSAGES` |
| 最大 LLM 尝试次数 | `retry-helpers.ts:3` | 3 | `MAX_LLM_ATTEMPTS` |
| 基础退避 | `retry-helpers.ts:4` | 500 ms | `BASE_BACKOFF_MS`；每次尝试翻倍 |
| Doom-loop 阈值 | `doom-loop.ts:1` | 3 | `DOOM_LOOP_THRESHOLD` 次连续相同调用 |
| 会话锁 TTL | `apps/server/src/redis-session-lock.ts:16` | 300000 ms（5 分钟） | `LOCK_TTL_MS` |
| Upstash 取消轮询 | `apps/server/src/upstash-cancellation.ts:4` | 750 ms | `POLL_INTERVAL_MS` |
| Upstash 取消标志 TTL | `apps/server/src/upstash-cancellation.ts:5` | 60 s | `CANCEL_TTL_SEC` |

[Deferred Tool Binding]: ../02-tool-system.md#deferred-tool-binding
