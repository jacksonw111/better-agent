# MCP 集成

better-agent 以三种不同形态集成 Model Context Protocol：**用户注册的远程 MCP 服务器**（任何用户添加 URL + bearer token 并将其链接到代理）、一个**第一方 MCP Worker**（`apps/mcp/`，一个暴露 X/Twitter 工具的无状态 JSON-RPC 端点），以及一个**进程内 Memory MCP 服务器**（`apps/server/src/memory-mcp.ts`，为桥接连接的本地代理提供 `memory_search` / `memory_add`）。这三者在运行时都通过相同的 `McpService` → `ToolDef` 路径触达。

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│  Runtime turn                                               │
│    assembleAgentToolDefs → safeMcpDefs → buildMcpToolDefs   │
│      → McpService.listTools() / execute()                   │
└──────────────────────────┬──────────────────────────────────┘
                           │
        ┌──────────────────┼───────────────────────┐
        ▼                  ▼                       ▼
  User MCP servers   First-party MCP Worker   Memory MCP server
  (buildMcpResolver) (apps/mcp, CF Worker)    (/mcp/memory, in-process)
  Streamable HTTP    Streamable HTTP          Streamable HTTP
  bearer auth        bearer = X auth_token    bearer = bridge token
```

通用抽象是 `McpService`（`packages/agent/src/tool/mcp-tools.ts:10`）：

```ts
interface McpService {
  execute(input: { toolName: string; args: unknown }): Promise<ExecuteResult>;
  listTools(): Promise<McpToolMeta[]>;
}
```

`buildMcpToolDefs`（`mcp-tools.ts:16`）将一个 `McpService` 转换为 `ToolDef[]`，`assembleAgentToolDefs` 将它们全部标记为 `defer: true`，使其在超过阈值时位于 `search_tools` 背后。

## 关键文件

| 文件 | 职责 |
|------|----------------|
| `apps/server/src/mcp.ts` | `buildMcpResolver` — 用户服务器连接、CF 1042 绑定、按调用的 `withClient` |
| `packages/api/src/routers/mcp.ts` | `mcpRouter` — list/create/delete 服务器、tools 诊断、所有权检查 |
| `packages/db/src/schema/mcp.ts` | `mcpServers` 表 |
| `packages/db/src/repositories/mcp-server-store.ts` | `createMcpServerStore` — 加密的认证头、脱敏列表 |
| `packages/agent/src/tool/mcp-tools.ts` | `McpService` 接口、`buildMcpToolDefs` |
| `apps/mcp/src/app.ts` | 第一方 MCP Worker Hono 应用（无状态 JSON-RPC） |
| `apps/mcp/src/mcp-server.ts` | `handleMessage` — JSON-RPC 分发、X 工具执行 |
| `apps/mcp/src/x-tool-defs.ts` | 8 个 X 工具定义 + `TOOL_NAMES` 集合 |
| `apps/server/src/memory-mcp.ts` | Memory MCP 子应用、bridge-token 认证、JSON-RPC |
| `apps/server/src/memory-mcp-tools.ts` | `memory_search` / `memory_add` 定义 + 实现 |

## 数据流

### 用户 MCP 服务器

**注册**（`packages/api/src/routers/mcp.ts`）。`createServer`（`mcp.ts:82`）接收 `{ name, url, bearerToken? }`，通过 `McpServerStore.create` 存储该行，然后**立即验证**——连接并调用 `listTools()`（`mcp.ts:61`）。如果连接失败，该行被删除并把错误暴露给 owner——一个损坏的服务器永远不会被静默持久化。

**存储**（`packages/db/src/schema/mcp.ts`）。`mcpServers` 表持有 `id`、`userId`（指向 users 的外键）、`name`、`url`、`authHeaderCipher`（完整的 `Bearer …` 值，通过/provider keys 相同的 `SecretBox` 加密）、`authLast4`（脱敏）以及时间戳。`McpServerStore.create`（`mcp-server-store.ts:51`）加密 header 并存储最后 4 个字符；`getAuthHeader`（`mcp-server-store.ts:47`）在服务器端解密；`listByUser`（`mcp-server-store.ts:35`）仅返回脱敏行。

**所有权**由 `requireOwnedMcpServer`（`mcp.ts:35`）强制执行：缺失的服务器**或**由其他用户拥有的服务器都返回 `NOT_FOUND`，因此所有权永远不会通过错误差异泄漏。删除是级联的：`unlinkMcpServer` 从每个链接它的代理中移除该服务器 id（`mcp.ts:104`）。

**解析器模式**（`apps/server/src/mcp.ts:158` `buildMcpResolver`）。服务器暴露一个 `(serverId) => Promise<McpService | null>` 解析器。给定一个存储的 id，它：

1. 获取该行（`store.getById`）。
2. 解密认证头（`store.getAuthHeader`）。
3. 决定是否通过 Cloudflare 服务绑定路由（见下文）。
4. 返回 `createMcpService(target)`。

**针对错误 1042 的 CF 服务绑定**（`mcp.ts:141`）。Cloudflare 以错误 1042 阻止同账户 Worker 之间通过公共 URL 的 fetch。解析器通过主机名标记（`INTERNAL_MCP_HOST_MARKER = "better-agent-mcp"`，`mcp.ts:16`）检测我们自己的 MCP worker，如果提供了 `ServiceBinding`，就把传输的 `fetch` 替换为 `bindingFetch(binding)`（`mcp.ts:137`），它直接调用绑定的 Worker——URL 中的主机名被忽略，只有绑定目标起作用。

**按调用的连接**（`mcp.ts:54` `withClient`）。每个 `listTools` / `execute` 在 `finally` 中连接（`client.connect`）、运行并关闭。MCP 会话廉价（Streamable HTTP 上单次 POST 握手），按调用连接避免了跨 Worker 隔离区的过期会话状态。所有操作通过 `withTimeout` 包装在 45 秒超时内（`MCP_TIMEOUT_MS`，`mcp.ts:11`）。

**注册时验证**是关键的 UX 特性：owner 立即获得反馈（错误的 URL、坏的 token），而不是一个只在轮次时刻才失败的静默损坏服务器。

### 第一方 MCP Worker（`apps/mcp/`）

一个独立的 Cloudflare Worker，通过 Streamable HTTP 以**无状态 JSON 模式**暴露 X（Twitter）工具。每个 POST 携带一条 JSON-RPC 消息；响应是纯 JSON（规范允许以此代替 SSE 流）。不保留任何会话状态——用户的 X `auth_token` 作为 Bearer token 随每个请求携带。

**应用层**（`apps/mcp/src/app.ts:22` `buildApp`）。一个 Hono 应用，带一条 POST 路由：解析 JSON（或返回 `PARSE_ERROR`），通过 `bearerToken`（`app.ts:14`）提取 bearer token，委托给 `handleMessage`，并返回 JSON（通知则返回 `202`）。

**JSON-RPC 分发**（`apps/mcp/src/mcp-server.ts:170` `handleMessage`）：

| 方法 | 行为 |
|--------|----------|
| `initialize` | 返回 `protocolVersion`（`2025-06-18`，`mcp-server.ts:20`）、`capabilities: { tools: {} }`、服务器信息 |
| `ping` | 返回空结果 |
| `tools/list` | 返回来自 `x-tool-defs.ts` 的 8 个 `TOOLS` |
| `tools/call` | 路由到 `callTool` → `runTool`，带节流 + 友好错误 |
| `notifications/*` | 返回 `null`（无响应体，HTTP 202） |
| 其他 | `METHOD_NOT_FOUND`（-32601） |

**8 个 X 工具**（`apps/mcp/src/x-tool-defs.ts:26`）：`x_search_users`、`x_search_tweets`、`x_user_tweets`、`x_user_replies`、`x_user_media`、`x_followers`、`x_following`、`x_tweet_thread`。五个基于 handle 的工具（`x_user_tweets` … `x_following`）共享一个输入 schema 工厂 `handleTool`（`x-tool-defs.ts:13`），接收 `screen_name` + 可选 `limit`。`TOOL_NAMES`（`x-tool-defs.ts:95`）是 `tools/call` 的验证集合。

**工具执行**（`mcp-server.ts:86` `runTool`）从 bearer token 创建一个 X 客户端，按名称分发，并返回 `toolText(JSON.stringify(...))`。`callTool`（`mcp-server.ts:134`）针对 `TOOL_NAMES` 验证工具名，要求非 null 的 `authToken`（否则给出可操作的错误消息），将执行包装在 `throttleX`（速率限制处理）中，并通过 `friendlyError`（`mcp-server.ts:51`）将 `XAuthError` / `XRateLimitError` 转换为人类可读的消息。工具结果被扁平化：`contentToOutput` 风格的 `toolText` 产生 `{ content: [{ type: "text", text }], isError }`。

### Memory MCP 服务器

一个挂载在主服务器应用内 `/mcp/memory` 的**进程内** MCP 服务器（不是独立的 Worker），为桥接连接的本地代理（claude-code、opencode、pi、codex）提供对 memory 系统的访问。它位于 `apps/server` 中，因为它需要 DB 存储和 embedding 客户端。

**认证：bridge token 作为主体**（`apps/server/src/memory-mcp.ts:127` `resolveTokenId`）。Bearer 凭据是代理的 bridge token（`bt_…`）。`resolveTokenId` 对其哈希（与 bridge plane 相同的 `hashToken`）并通过 `bridgeToken.findByHash` 查找；缺失或已撤销的 token 返回 `401`。解析出的 `tokenId` **就是**主体——它通过 `bridge_token_memories` 解析到已分配的 memories，与 bridge relay plane 完全一样。没有单独的认证表。

**应用层**（`memory-mcp.ts:146` `buildMemoryMcpApp`）。一个 Hono 子应用：解析 token（无效则 401），解析 JSON（解析错误则 400），委托给 `handleMemoryMcpMessage`，返回 JSON 或 202。

**JSON-RPC 分发**（`memory-mcp.ts:89`）镜像 X worker：`initialize`、`ping`、`tools/list`（返回 `MEMORY_TOOLS`）、`tools/call` → `callTool`。协议版本 `2025-06-18`，服务器信息 `better-agent-memory`。

**两个工具**（`apps/server/src/memory-mcp-tools.ts:37` `MEMORY_TOOLS`）：

- **`memory_search`**（`memory-mcp-tools.ts:127` `runSearch`）— 对查询做 embedding，跨分配给该 token 的**所有** memories 搜索（`listTokenMemories`），返回最多 `k` 项（默认 5，最大 20，通过 `clampK` 钳制）。每个结果格式化为 `[memoryName] (importance N) content`。
- **`memory_add`**（`memory-mcp-tools.ts:210` `runAdd`）— 将一条事实写入一个**可写**的 memory。`resolveWritable`（`memory-mcp-tools.ts:170`）选择目标：恰好一个 `read_write` 链接时选那一个，否则选匹配 `memory_name` 的那个；其余所有情况都返回一个可操作的错误，按名列出可写选项。条目以 `source: "extracted"` 添加（`memory-mcp-tools.ts:239`）——`'user'` 保留给来自 Web UI 的人工策展条目。

两个工具都要求 embedding 客户端已配置（否则给出明确错误），且两者都限定在 token 范围内：搜索跨所有已分配 memories 读取，添加只通过 `read_write` 链接写入。

## 设计理由

- **一个 `McpService` 接口，三种实现** — 运行时不关心 MCP 工具是用户服务器、第一方 worker，还是进程内 memory 服务器。所有都通过相同的 `buildMcpToolDefs` 产出 `ToolDef[]`，且都获得 `defer: true`。
- **到处是无状态 JSON 模式** — 每个请求是一个自包含的 POST，凭据在 header 中。这完全避开了会话管理，在 Workers 上尤为重要——那里长生命周期连接不可行且隔离区是临时的。
- **带绑定感知的解析器模式** — 解析器是决定传输路由（直接 fetch vs 服务绑定）的唯一位置。运行时和 API 只看到 `(serverId) => McpService`。CF 1042 的变通在此层之上是不可见的。
- **按调用的 MCP 连接** — 以每次操作一次握手为代价避免跨隔离区的过期会话状态，这在 Streamable HTTP 上很廉价。
- **用户服务器的创建即验证** — 在注册时连接并列出工具意味着 owner 立即看到“bad token”，而非在轮次中途。失败的验证会回滚该行。
- **Bridge token 作为 memory 主体** — 本地代理已持有 `bt_…` token；将其复用为 MCP bearer 意味着零新增认证面。该 token 解析到 bridge plane 使用的相同 memory 链接，保持单一事实来源。
- **所有权检查、所有权隐藏** — `requireOwnedMcpServer` 对缺失和他人拥有的服务器都返回 `NOT_FOUND`，防止枚举其他用户的服务器 id。

## 配置

| 旋钮 | 位置 | 默认值 | 备注 |
|------|----------|---------|-------|
| MCP 操作超时 | `apps/server/src/mcp.ts:11` | 45000 ms（45 秒） | `MCP_TIMEOUT_MS`，包装所有 `withLog` 调用 |
| MCP 协议版本 | `apps/mcp/src/mcp-server.ts:20` | `2025-06-18` | `PROTOCOL_VERSION`，由 `initialize` 返回 |
| Memory MCP 协议版本 | `apps/server/src/memory-mcp.ts:21` | `2025-06-18` | `MEMORY_MCP_PROTOCOL_VERSION` |
| 认证头存储 | `packages/db/src/schema/mcp.ts:18` | `authHeaderCipher` + `authLast4` | 通过 `SecretBox` 加密，最后 4 个字符脱敏 |
| 内部主机标记 | `apps/server/src/mcp.ts:16` | `better-agent-mcp` | 触发 CF 服务绑定路径 |
| MCP 客户端身份 | `apps/server/src/mcp.ts:12` | `{ name: "better-agent", version: "1.0.0" }` | `CLIENT_INFO`，在 `initialize` 时发送 |
| Memory 搜索默认 k | `apps/server/src/memory-mcp-tools.ts:20` | 5 | `DEFAULT_K`，最大 20（`MAX_K`） |
| Memory importance 范围 | `apps/server/src/memory-mcp-tools.ts:22` | 0–1 | 通过 `clampImportance` 钳制 |
| MCP 错误详情上限 | `packages/api/src/routers/mcp.ts:7` | 300 字符，深度 4 | `toMcpError` 中的 `MAX_DETAIL_LEN` / `MAX_DETAIL_DEPTH` |

Cloudflare `ServiceBinding` 在服务器装配时注入（`buildMcpResolver(store, internalBinding?)`），且仅在 Worker 部署中存在——在 Node/serverless 运行中不存在，那里同账户 fetch 限制不适用。
