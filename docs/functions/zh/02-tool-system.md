# 工具系统

工具系统组装代理可调用的工具，将其适配到 AI SDK 的 `ToolSet`，把庞大的工具集隐藏在 `search_tools` 网关背后，并在统一的 `ToolDef` 边界后集成远程（pending）、MCP 和 Composio 工具。

## 架构

每个工具，无论来源如何，都由单个 `ToolDef`（`packages/agent/src/tool/types.ts:16`）描述：

```ts
interface ToolDef {
  defer?: boolean;        // hide behind search_tools past the threshold
  description: string;
  execute(args: unknown, ctx: ToolContext): Promise<ExecuteResult>;
  name: string;
  parameters: JsonSchema;
}

interface ToolContext {
  abortSignal: AbortSignal;
  agentId: string;
  callId: string;
  messageId: string;
  sessionId: string;
}

interface ExecuteResult {
  isError?: boolean;
  output: string;
}
```

在轮次时刻，`buildTools`（`registry.ts:10`）将 `ToolDef[]` 转换为 AI SDK 的 `ToolSet`，用三个横切关注点包装每个 `execute`：

1. **Doom-loop 守卫** — 在第 3 次连续相同调用时短路。
2. **输出截断** — 上限为 50 KB / 2000 行。
3. **错误转换** — `ExecuteResult.isError` 变为抛出的 `Error`，AI SDK 将其呈现为 `tool-error` chunk，使模型能够作出反应。

一组提供商（built-in、composio、MCP、remote/pending）各自产出 `ToolDef[]`，由 API 层按代理和按轮次组装。

## 关键文件

| 文件 | 职责 |
|------|----------------|
| `packages/agent/src/tool/types.ts` | `ToolDef`、`ToolContext`、`ExecuteResult`、`JsonSchema` |
| `packages/agent/src/tool/registry.ts` | `buildTools` — `ToolDef[]` → AI SDK `ToolSet` |
| `packages/agent/src/tool/truncate.ts` | `truncateOutput` — 50 KB / 2000 行上限 |
| `packages/agent/src/tool/builtin-tools.ts` | `get_current_time` + opt-in 注册表 |
| `packages/agent/src/tool/remote-tools.ts` | `buildRemoteToolDefs` — 暂存客户端定义的工具 |
| `packages/agent/src/tool/pending-store.ts` | `PendingToolCallStore` 接口 + 内存实现，2 分钟 TTL |
| `packages/agent/src/tool/tool-search.ts` | `search_tools`、`shouldDefer`、`buildDeferredBinding` |
| `packages/agent/src/tool/mcp-tools.ts` | `McpService` 接口、`buildMcpToolDefs` |
| `packages/agent/src/tool/composio-tools.ts` | `ComposioService` 接口、`buildComposioToolDefs` |
| `packages/api/src/routers/agent-tool-defs.ts` | `assembleAgentToolDefs`、`safeComposioDefs`、`safeMcpDefs` |
| `apps/server/src/redis-pending-store.ts` | Redis pub/sub `PendingToolCallStore` |
| `apps/server/src/upstash-pending-store.ts` | Upstash REST `PendingToolCallStore` |

## 数据流

### 工具注册表

`buildTools`（`registry.ts:10`）是 `ToolDef` 与 AI SDK 之间的唯一接缝：

```ts
function buildTools(
  defs: ToolDef[],
  ctxBase: Omit<ToolContext, "callId">,
  opts?: { cacheLastToolDef?: boolean; guard?: DoomLoopGuard }
): ToolSet
```

对每个 def，它构建一个 AI SDK `tool({ ... })`，其 `execute`：

- 检查 `opts.guard?.check(def.name, args)`，若触发则返回 `DOOM_LOOP_MESSAGE`（`registry.ts:36`），
- 调用 `def.execute(args, ctx)`，将 AI SDK 的 `toolCallId` 接入为 `callId`，
- 将输出通过 `truncateOutput`（`registry.ts:44`）处理，
- 在 `result.isError` 时抛出，使 SDK 发出 `tool-error` chunk。

`cacheLastToolDef` 为**最后一个**工具的 schema 标注 Anthropic 的 `cacheControl: { type: "ephemeral" }`（`registry.ts:25`），使整个工具块（prompt 中最昂贵的部分）作为单个前缀被缓存。仅当提供商为 Anthropic 且缓存策略启用时才设置。重复的工具名会立即抛出（`registry.ts:17`）。

### 输出截断

`truncateOutput`（`truncate.ts:8`）强制执行两个上限——先 `MAX_OUTPUT_LINES = 2000`（`truncate.ts:2`），再 `MAX_OUTPUT_BYTES = 51200`（`truncate.ts:1`，恰好 50 KB）。当任一被超过时，它保留**头部**并追加 `[output truncated — N chars total; showing the head]`，让模型知道数据被丢弃了。

### 内置工具

无需外部凭据、在服务器端执行的工具。代理通过 `AgentConfig.builtinTools` 按 **id** 选择加入。注册表（`builtin-tools.ts:21`）目前恰好持有一个：

- `get_current_time`（`builtin-tools.ts:14`）— 返回 `new Date().toISOString()`。

`BUILTIN_TOOLS`（`builtin-tools.ts:26`）是供管理后台 UI 选择器使用的元数据（id/label/category/description）。`buildBuiltinToolDefs(ids)`（`builtin-tools.ts:35`）按代理选定的 id 过滤注册表。它们**不**被标记为 `defer`——它们数量少且包含成本低。

### 远程 / Pending 工具

执行发生在服务器之外（例如桌面桥接代理）的、由客户端定义的工具。`buildRemoteToolDefs`（`remote-tools.ts:10`）将客户端提供的 schema 转换为 `ToolDef[]`，其 `execute` 不执行任何操作——它**暂存**该调用：

```ts
execute: (_args, ctx) =>
  store.park({ sessionId: ctx.sessionId, callId: ctx.callId, abortSignal: ctx.abortSignal })
```

`PendingToolCallStore`（`pending-store.ts:5`）是 park/resolve 协议：

```ts
interface PendingToolCallStore {
  park(input: { sessionId; callId; abortSignal? }): Promise<ExecuteResult>;
  resolve(input: { sessionId; callId; result }): Promise<void>;
}
```

内存实现（`pending-store.ts:22`）持有一个 `Map<key, settle>`。`park` 返回一个 promise，当为相同 `(sessionId, callId)` 调用 `resolve` 时 resolve，在 abort 时 reject，并在 **`PENDING_TTL_MS = 120_000`**（2 分钟，`pending-store.ts:3`）后**自动拒绝**。key 是 `${sessionId}:${callId}`（`pending-store.ts:18`）。

分布式实现：

- **Redis**（`apps/server/src/redis-pending-store.ts:48`）— `park` 订阅 channel `toolresult:${sessionId}:${callId}`；`resolve` 发布 JSON 序列化的结果。因果顺序成立，因为客户端只有在收到 `tool-call` 事件后才调用 `submitToolResult`，而该事件仅在 `park` 已订阅后才触发。
- **Upstash**（`apps/server/src/upstash-pending-store.ts`）— 用于 Workers 的基于轮询的变体。

### 延迟工具绑定（`search_tools`）

当代理有许多工具时，每轮发送所有 schema 开销很大。当超过 `DEFER_THRESHOLD = 12`（`tool-search.ts:5`）个 def 被标记为 `defer: true` 时，`shouldDefer`（`tool-search.ts:56`）返回 true。低于阈值时，行为不变。

当延迟激活时，`buildDeferredBinding`（`tool-search.ts:148`）：

1. 将 defs 拆分为始终激活（非 `defer`）和延迟（`defer`）。
2. 用所有非延迟名**加上** `search_tools` 作为初始激活集。
3. 向注册集追加一个合成的 `search_tools` 工具（`tool-search.ts:79`）。

然后运行时使用 AI SDK 的 `prepareStep`，每步仅将 `activeNames()` 作为 `activeTools` 暴露（`runtime.ts:99` `deferStepOptions`）。`search_tools.execute` 根据查询对延迟 defs 排名，并将匹配名**添加**到激活集——该集合在一轮内只增长。

排名（`tool-search.ts:28` `scoreDef`）是一个 token 重叠评分：名匹配权重为 3×（`NAME_WEIGHT`，`tool-search.ts:7`），描述匹配权重为 1。`tokenize`（`tool-search.ts:21`）小写化并按非字母数字拆分，丢弃长度小于 2 个字符的 token。`rankTools`（`tool-search.ts:44`）只保留正分，按降序排序。`runSearch`（`tool-search.ts:105`）每次查询取前 8 个（`SEARCH_TOP_K`，`tool-search.ts:6`），并支持批量 `queries` 数组，使模型一次调用就能获取所需的一切。

### MCP 工具

`McpService`（`mcp-tools.ts:10`）是已连接的远程 MCP 服务器的接口：

```ts
interface McpService {
  execute(input: { toolName: string; args: unknown }): Promise<ExecuteResult>;
  listTools(): Promise<McpToolMeta[]>;
}
```

`buildMcpToolDefs`（`mcp-tools.ts:16`）调用 `listTools()` 一次，将每个 meta 映射为一个 `ToolDef`，其 `execute` 委托给 `service.execute({ toolName, args })`。具体的 `McpService`（连接、认证、传输）位于服务器应用中——参见 [04-mcp.md](./04-mcp.md)。

### Composio 工具

`ComposioService`（`composio-tools.ts:25`）抽象了 Composio 的工具包目录、按用户的连接和工具执行。认证在接口层面有两种形式：

- **OAuth** — `connect(userId, toolkit)` 返回一个重定向 URL（`composio-tools.ts:27`），用于 `authSchemes` 包含 `OAUTH2` 的工具包。
- **API key** — `connectWithKey({ userId, toolkit, scheme, key })`（`composio-tools.ts:29`），用于 `API_KEY` / `BEARER_TOKEN` 工具包。

`buildComposioToolDefs`（`composio-tools.ts:52`）调用 `listTools(userId, toolkits)`——范围限定为用户的**活跃**连接——将每个映射为一个 `ToolDef`，其 `execute` 调用 `service.execute({ userId, toolName, args })`。工具包并行列出（每个一个请求），而非顺序。

### 工具组装

`assembleAgentToolDefs`（`packages/api/src/routers/agent-tool-defs.ts:75`）是按轮次的入口点，收集代理可调用的所有工具：

```ts
async function assembleAgentToolDefs(context, agent: {
  builtinTools: string[];
  composioAccountIds: string[];
  mcpServerIds: string[];
  toolAllowlist?: string[] | null;
}): Promise<ToolDef[]>
```

它并行运行三个来源：

1. **Composio** — 对 `composioAccountIds` 做 `Promise.all`，每个经过 `safeComposioDefs`（`agent-tool-defs.ts:16`）。每个账户：列出活跃连接 → 唯一 toolkit slugs → `buildComposioToolDefs`。失败被记录并产出 `[]`（一个损坏的账户永远不会破坏轮次）。
2. **MCP** — 对 `mcpServerIds` 做 `Promise.all`，每个经过 `safeMcpDefs`（`agent-tool-defs.ts:43`），它出于同样原因将 `buildMcpToolDefs` 包在 try/catch 中。
3. **Built-in** — `buildBuiltinToolDefs(agent.builtinTools)`。

然后 `shapeSourceDefs`（`agent-tool-defs.ts:63`）对 composio+MCP 并集应用两个变换：

- 可选的 `toolAllowlist`（名允许列表），以及
- 对**每个**存活的 composio/MCP def 标记 `defer: true`——它们庞大且众多，因此总是成为 search-gateway 管理的对象。

内置工具在 shaping **之后**追加，且**不**被延迟。

## 设计理由

- **统一的 `ToolDef`** — 一个形状涵盖 built-in、remote、MCP 和 Composio 工具。运行时从不按工具来源分支；`buildTools` 是唯一接触 AI SDK 的地方。
- **`defer` 在源头 opt-in** — Composio/MCP 自行标记为可延迟；built-in 不标记。运行时的 `shouldDefer` 基于数量决定是否启用网关，因此行为优雅降级（小工具集永远不会被网关限制）。
- **`search_tools` 只增长集合，从不缩小** — 一旦暴露，工具在轮次剩余时间内保持可调用，避免闪烁。token 成本随*已用*工具扩展，而非随*可用*工具扩展。
- **安全包装器吞掉失败** — 一个行为异常的 MCP 服务器或过期的 Composio 连接产出零工具，而非使整个轮次失败。错误在服务器端记录。
- **按调用 MCP 连接** — 服务器的 `withClient` 在每次操作上连接、运行并关闭。MCP 会话廉价（Streamable HTTP 上一次 POST 握手），按调用连接避免了跨 Worker 隔离区的过期会话状态。
- **Pending TTL** — 一个永远不被 resolve 的暂存调用在 2 分钟内自动拒绝，因此断开的客户端不能永远挂起一个轮次。

## 配置

| 旋钮 | 位置 | 默认值 | 备注 |
|------|----------|---------|-------|
| 工具输出字节上限 | `truncate.ts:1` | 51200（50 KB） | `MAX_OUTPUT_BYTES` |
| 工具输出行上限 | `truncate.ts:2` | 2000 | `MAX_OUTPUT_LINES` |
| 延迟绑定阈值 | `tool-search.ts:5` | 12 | `DEFER_THRESHOLD` 个 defer 标记工具 |
| 搜索 top-K | `tool-search.ts:6` | 8 | 每次查询的 `SEARCH_TOP_K` |
| 名匹配权重 | `tool-search.ts:7` | 3 | `NAME_WEIGHT` vs 描述权重 1 |
| 最小 token 长度 | `tool-search.ts:8` | 2 | 用于排名的 `MIN_TOKEN_LEN` |
| Pending 调用 TTL | `pending-store.ts:3` | 120000 ms（2 分钟） | `PENDING_TTL_MS` |
| Anthropic 工具缓存 | `registry.ts:25` | 仅最后一个工具 | `cacheLastToolDef`，由缓存策略设置 |
