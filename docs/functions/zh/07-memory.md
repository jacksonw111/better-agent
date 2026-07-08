# 记忆系统

记忆系统为 agent 提供持久化、可搜索的知识库。一个 `memory` 是一个命名的、可拥有的原子事实（`memory_items`）集合，每个事实带一个用于 kNN 检索的嵌入向量。记忆以多对多方式分配给 agent（web 或本地/桥接），每个关联带一个角色（`read` | `read_write`）。Web UI 管理记忆和条目；一个 Memory MCP 服务端向桥接连接的本地 agent 暴露 `memory_search` / `memory_add` 工具。

## 架构

```
┌─────────────────────────────────────────────────────────────────┐
│  apps/web（浏览器）                                              │
│    /memories          MemoryList（表格）+ CreateMemoryDialog     │
│    /memories/$id      MemoryDetail + AddItemComposer + MemoryItems │
│    Agent/本地设置     MemoryPicker / AssignedMemories           │
└──────────────────────┬──────────────────────────────────────────┘
                       │  oRPC（Bearer JWT）
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│  packages/api — memoryRouter (userProcedure)                    │
│    createMemory / listMemories / getMemory / deleteMemory       │
│    addItem / listItems / deleteItem                             │
│    assignMemory / unassignMemory / listAssigned                 │
│    search（嵌入 → kNN）                                          │
│  memory-support.ts: requireOwnedMemory, embedAndAddItem,         │
│    embedAndSearchItems, resolveTargetLinks, mutateAssignment     │
└──────────────────────┬──────────────────────────────────────────┘
                       │
          ┌────────────┴─────────────┐
          ▼                          ▼
┌──────────────────────┐   ┌──────────────────────────────────────┐
│  packages/db          │   │  apps/server — Memory MCP            │
│  memory-store.ts      │   │  /mcp/memory（Hono 子应用）           │
│  memory-item-store.ts │   │  bridge-token 认证（bt_ → 哈希查找）  │
│                       │   │  工具：memory_search, memory_add      │
│  schema/memory.ts：   │   │  角色门控：add 需要 read_write        │
│  memories             │   └──────────────────────┬───────────────┘
│  agent_memories       │                          │
│  bridge_token_memories│                          │
│  memory_items         │   ┌──────────────────────▼───────────────┐
│  memory_embeddings    │   │  EmbeddingClient（SiliconFlow         │
│  (pgvector HNSW)      │   │  BAAI/bge-m3, 1024 维）               │
└──────────────────────┘   └───────────────────────────────────────┘
```

### 记忆存储

schema（`packages/db/src/schema/memory.ts`）有五张表：

- **`memories`**（`memory.ts:28`）— 命名知识库：`id`、`userId`（所有者）、`name`、`description`、时间戳。在 `userId` 上建索引。
- **`agent_memories`**（`memory.ts:51`）— **web agent** 的多对多关联：`agentId`（FK 到 `agents`）、`memoryId`、`role`（`read` | `read_write`，默认 `read`）。主键在 `(agentId, memoryId)`。
- **`bridge_token_memories`**（`memory.ts:72`）— **本地/桥接 agent** 的平行关联，以 `tokenId`（FK 到 `bridge_tokens`）为键而非 `agentId`。相同形状：`tokenId`、`memoryId`、`role`。这意味着本地 agent 以与 web agent 相同的多对多、角色限定方式获取记忆。
- **`memory_items`**（`memory.ts:92`）— 原子事实：`content`、`source`（`user` | `extracted` | `reflection`，默认 `user`）、`importance`（0–1，默认 0.5）、`validFrom`/`validTo`（软删除水位——`null` = 当前）、`lastAccessedAt`、`metadata`（jsonb）。部分索引 `memory_items_memory_id_current_idx` 在 `(memoryId) WHERE validTo IS NULL` 上支撑热读路径。
- **`memory_embeddings`**（`memory.ts:124`）— 每个条目一个嵌入，从 `memory_items` 分离，因此重新嵌入/模型 A-B 测试永远不会重写事实行。`embedding` 是 `vector(1024)`（SiliconFlow `BAAI/bge-m3` 宽度），`model` 记录生成模型。带 `vector_cosine_ops` 的 HNSW 索引用于 kNN 检索。

### 记忆分配

分配是多对多带角色的。一个记忆可跨多个 agent 共享；每个 agent 默认为 `read`，除非显式授予 `read_write`。`resolveTargetLinks`（`memory-support.ts:207`）断言调用者拥有目标 agent/token，然后返回其记忆关联。`mutateAssignment`（`memory-support.ts:227`）在关联/取消关联之前断言对记忆和目标的双重所有权。`assertOneTarget`（`memory-support.ts:172`）强制每次调用恰好指定 `agentId`/`tokenId` 中的一个。

`MemoryStore`（`packages/db/src/repositories/memory-store.ts:148`）提供 `assignAgent`/`unassignAgent`/`listAgentMemories`（web agent）和 `assignToken`/`unassignToken`/`listTokenMemories`（本地 agent）——两者在冲突时作为 upsert（`onConflictDoUpdate` 设置角色）。`deleteWithChildren`（`memory-store.ts:104`）在一个事务中级联：embeddings → items → agent 关联 → token 关联 → memory（所有者限定，因此非所有者的调用不会删除任何内容）。

### 记忆管理 UI

- **列表页**（`/memories`，`memories.index.tsx`）— `MemoryList`（`memory-list.tsx:25`）渲染用户记忆的 `MemoryTable`；`CreateMemoryDialog`（`create-memory-dialog.tsx:160`）创建命名知识库并导航到其详情页。
- **详情页**（`/memories/$memoryId`，`memories.$memoryId.tsx`）— `MemoryDetail`（`memory-detail.tsx:36`）显示记忆的名称/描述，一个 `AddItemComposer`（`add-item-composer.tsx:84`）用于添加事实（带可选 0–1 重要性），以及 `MemoryItems` 列出当前条目（可软删除）。
- **记忆选择器**（`memory-picker.tsx:41`）— 用户记忆的多选复选框列表，用于 agent 创建流程。选择在 agent 存在后变为 `read` 角色分配（`assign-memories.ts:8` `assignMemoriesTo`）。
- **已分配记忆**（`assigned-memories.tsx:140`）— 显示在 agent/本地 agent 设置中：列出已分配记忆，带角色切换（read ⇄ read & write，通过重新分配 upsert）和取消分配，以及一键分配剩余记忆。由 `LocalAgentSettingsDialog` 的 Memories 标签页使用。

### Memory MCP

Memory MCP 服务端（`apps/server/src/memory-mcp.ts`）是一个进程内 Hono 子应用，挂载在 `/mcp/memory`（`app.ts:219`），在 oRPC catch-all **之前**注册，因此请求在此以 bridge-token 认证终止，而非付出 oRPC 分发开销。它向桥接连接的本地 agent 暴露两个工具：

- **`memory_search`**（`memory-mcp-tools.ts:127` `runSearch`）— 嵌入查询，搜索分配给令牌的**所有**记忆（`listTokenMemories`），返回最多 `k` 个条目（默认 5，最大 20）。每个结果格式化为 `[memoryName] (importance N) content`。
- **`memory_add`**（`memory-mcp-tools.ts:210` `runAdd`）— 向一个**可写**记忆写入事实。`resolveWritable`（`memory-mcp-tools.ts:170`）选择目标：如果恰好有一个 `read_write` 关联则选它，否则选匹配 `memory_name` 的那个；其他所有情况返回列出可写选项的可操作错误。条目以 `source: "extracted"` 添加（`'user'` 保留给人工策划的 web 条目）。

**认证：bridge token 作为主体**（`memory-mcp.ts:127` `resolveTokenId`）。Bearer 凭据是 agent 的 `bt_…` 令牌。`resolveTokenId` 对其哈希（与桥接面相同的 `hashToken`）并通过 `bridgeToken.findByHash` 查找；缺失或已撤销的令牌返回 401。解析出的 `tokenId` **就是**主体——它通过 `bridge_token_memories` 解析到已分配记忆，与桥接中继面完全相同。无需单独的认证表。

**角色门控**：`memory_search` 跨所有已分配记忆读取（任何角色）；`memory_add` 仅通过 `read_write` 关联写入——只有 `read` 关联的令牌收到可操作错误："This agent has no writable memory. Ask the owner to assign one with the read_write role."

Web 路由和 MCP 工具都流经相同的共享嵌入瓶颈（`memory-support.ts` 中的 `embedAndAddItem` / `embedAndSearchItems`），因此向量旁记录的模型在两个入口点之间永远不会分歧，且字符限制守卫（`MAX_EMBED_CHARS=8000`）对两者都适用。

## 关键文件

| 文件 | 职责 |
|------|----------------|
| `packages/db/src/schema/memory.ts` | `memories`、`agent_memories`、`bridge_token_memories`、`memory_items`、`memory_embeddings` 表 |
| `packages/db/src/repositories/memory-store.ts` | `createMemoryStore`：CRUD、agent/token 关联操作、级联删除 |
| `packages/db/src/repositories/memory-item-store.ts` | `createMemoryItemStore`：add（item+embedding 事务）、listCurrent、softDelete、kNN 搜索 |
| `packages/api/src/routers/memory.ts` | `memoryRouter`：create/list/get/delete memory、add/list/delete items、assign/unassign/listAssigned、search |
| `packages/api/src/routers/memory-support.ts` | `requireOwnedMemory`、`embedAndAddItem`、`embedAndSearchItems`、`resolveTargetLinks`、`mutateAssignment`、输入 schema |
| `packages/agent/src/memory-ports.ts` | `MemoryStore`、`MemoryItemStore`、`EmbeddingClient`、`MemoryRow`、`MemoryItemRow`、`MemoryRole`、`MemoryItemSource` 端口类型 |
| `apps/web/src/components/memory/memory-list.tsx` | `MemoryList`：表格 + 删除 |
| `apps/web/src/components/memory/memory-detail.tsx` | `MemoryDetail`：name/desc + AddItemComposer + MemoryItems |
| `apps/web/src/components/memory/create-memory-dialog.tsx` | `CreateMemoryDialog`：name + description → 导航到详情 |
| `apps/web/src/components/memory/add-item-composer.tsx` | `AddItemComposer`：content + 可选 importance（0–1） |
| `apps/web/src/components/memory/memory-picker.tsx` | `MemoryPicker`：用于 agent 创建的多选复选框列表 |
| `apps/web/src/components/memory/assign-memories.ts` | `assignMemoriesTo` / `assignMemoriesSafely`：创建后分配 |
| `apps/web/src/components/memory/assigned-memories.tsx` | `AssignedMemories`：角色切换 + 取消分配 + 一键分配 |
| `apps/web/src/routes/memories.index.tsx` | `/memories` 路由：列表 + 创建对话框 |
| `apps/web/src/routes/memories.$memoryId.tsx` | `/memories/$memoryId` 路由：详情页 |
| `apps/server/src/memory-mcp.ts` | `buildMemoryMcpApp`：Hono 子应用、bridge-token 认证、JSON-RPC 分发 |
| `apps/server/src/memory-mcp-tools.ts` | `MEMORY_TOOLS`, `runSearch`, `runAdd`, `resolveWritable`, `MemoryMcpServices` |
| `apps/server/src/app.ts:219` | 挂载点：`app.route("/mcp/memory", buildMemoryMcpApp(services))` |

## 数据流

### 创建记忆 + 添加条目（web）

```
CreateMemoryDialog → orpc.memory.createMemory({name, description})
  → memoryStore.create({userId, name, description}) → memories 行
  → 导航到 /memories/$memoryId
AddItemComposer → orpc.memory.addItem({memoryId, content, importance?})
  → requireOwnedMemory（缺失/其他所有者时 NOT_FOUND）
  → embedAndAddItem(embeddingClient, memoryItemStore, {…})
    → assertEmbedTextWithinLimit（8000 字符）
    → embedText(client, content) → SiliconFlow BAAI/bge-m3 → 1024 维向量
    → memoryItemStore.add: 事务（insert memory_items + insert memory_embeddings）
  → 失效 listItems 查询
```

### 分配记忆给 agent/本地 agent

```
AssignedMemories → orpc.memory.assignMemory({agentId|tokenId, memoryId, role})
  → mutateAssignment(context, userId, input, "assign")
    → assertOneTarget（恰好一个 agentId/tokenId）
    → requireOwnedMemory（调用者拥有记忆）
    → assertOwnedAgent 或 assertOwnedToken（调用者拥有目标）
    → memoryStore.assignAgent({agentId, memoryId, role})（upsert）
      或 memoryStore.assignToken({tokenId, memoryId, role})（upsert）
  → 失效 listAssigned 查询
```

### 搜索（web）

```
orpc.memory.search({agentId|tokenId, query, k?})
  → resolveTargetLinks(context, userId, input) → links [{memoryId, role}]
  → 无记忆: return []
  → embedAndSearchItems(embeddingClient, memoryItemStore, {query, memoryIds, k})
    → embedText(client, query)
    → memoryItemStore.search: 对当前条目 kNN（validTo IS NULL）
      ORDER BY cosineDistance(embedding, $query) LIMIT k
      （使用 HNSW vector_cosine_ops 索引）
    → 更新返回条目的 lastAccessedAt
```

### Memory MCP（本地 agent）

```
Agent 调用 /mcp/memory（POST, Bearer bt_…）
  → resolveTokenId: hashToken → bridgeToken.findByHash → tokenId（无效/已撤销则 401）
  → handleMemoryMcpMessage:
    → initialize → protocolVersion, capabilities, serverInfo
    → tools/list → MEMORY_TOOLS [memory_search, memory_add]
    → tools/call:
      → memory_search:
        → listTokenMemories(tokenId) → links
        → 为空: "No memories are assigned to this agent."
        → embedAndSearchItems(client, memoryItem, {query, memoryIds, k})
        → 格式: [memoryName] (importance N) content
      → memory_add:
        → resolveWritable(tokenId, memory_name?) → {memoryId, name} | {error}
          → listTokenMemories → 过滤 role==="read_write"
          → 0 个: "no writable memory" 错误
          → 1 个（无名）或名称匹配: 目标
          → >1 个（无名）: "pass memory_name" 错误
        → embedAndAddItem(client, memoryItem, {memoryId, content, source:"extracted"})
        → "Saved to memory 'name' (item id)"
```

## 设计理由

- **嵌入与事实分离**（`memory_embeddings` 与 `memory_items` 分离）— 重新嵌入或切换模型永远不会重写事实行；只有嵌入列与模型绑定。A/B 测试模型是非破坏性的。
- **通过 `validTo` 软删除** — 条目永远不会从数据库硬删除；`validTo` 设为 `now()`，将它们从当前集合和 kNN 候选集合中移除（部分索引 `WHERE validTo IS NULL`）。可恢复、可审计。
- **多对多带角色** — 一个知识库跨 agent 共享，每个有独立的 `read`/`read_write`。一个共享的"项目约定"记忆对大多数 agent 只读，但对一个 agent 可写。
- **两张关联表（agent + token）** — web agent 和本地/桥接 agent 以不同的 FK 为键（`agents.id` vs `bridge_tokens.id`），但形状相同。本地 agent 以与 web agent 相同的方式获取记忆；API 和 UI 复用相同模式。
- **检查所有权，隐藏所有权** — `requireOwnedMemory` 对缺失和其他所有者的记忆都返回 `NOT_FOUND`，因此所有权永远不会通过错误差异泄露。
- **Bridge token 作为 MCP 主体** — 本地 agent 已持有 `bt_…` 令牌；将其复用为 MCP bearer 意味着零新增认证表面。令牌解析到桥接面使用的相同记忆关联，保持单一真相源。
- **共享嵌入瓶颈** — web 路由和 MCP 工具都调用 `embedAndAddItem`/`embedAndSearchItems`，因此字符限制、错误净化（提供商内部信息永远不回显给调用者——`SERVICE_UNAVAILABLE`）和模型记录统一应用。
- **`source` 区分来源** — `user`（web UI 策划）、`extracted`（通过 MCP agent 撰写）、`reflection`（未来自动捕获阶段）。Web 条目保留给人工策划；MCP 添加的条目标记为 `extracted`。
- **默认重要性 0.5** — 策划的事实尚无学习到的显著性；中间刻度是中性起点。
- **基于 HNSW 余弦的 kNN** — pgvector 的 HNSW 索引配 `vector_cosine_ops` 提供近似 kNN 检索；查询构建器中的 `cosineDistance` 确保使用索引。
- **可操作的写入错误** — `resolveWritable` 从不静默失败：它按名称列出可写选项，告知 agent 应传入什么作为 `memory_name`。

## 配置

| 配置项 | 位置 | 默认值 | 备注 |
|------|----------|---------|-------|
| 嵌入维度 | `schema/memory.ts:22` `EMBEDDING_DIMENSIONS` | 1024 | SiliconFlow `BAAI/bge-m3` 输出宽度 |
| 嵌入模型 | `EmbeddingClient.model` | `BAAI/bge-m3` | SiliconFlow OpenAI 兼容 API |
| 默认重要性 | `schema/memory.ts:24` `DEFAULT_IMPORTANCE` | 0.5 | 中性中间刻度起点 |
| 重要性范围 | `memory-support.ts:19-20` | 0–1 | `MIN_IMPORTANCE` / `MAX_IMPORTANCE` |
| 最大嵌入字符 | `memory-support.ts:24` `MAX_EMBED_CHARS` | 8000 | 在共享嵌入瓶颈处限制成本/DoS |
| 默认搜索 k | `memory-support.ts:17` `DEFAULT_SEARCH_K` | 5 | web 搜索默认值 |
| 最大搜索 k（web） | `memory-support.ts:18` `MAX_SEARCH_K` | 50 | web 搜索上限 |
| MCP 默认 k | `memory-mcp-tools.ts:20` `DEFAULT_K` | 5 | MCP `memory_search` 默认值 |
| MCP 最大 k | `memory-mcp-tools.ts:21` `MAX_K` | 20 | MCP `memory_search` 上限（通过 `clampK` 钳制） |
| 记忆角色 | `memory-ports.ts:12` `MemoryRole` | `read` | `read` | `read_write` |
| 记忆条目来源 | `memory-ports.ts:16` `MemoryItemSource` | `user` | `user` | `extracted` | `reflection` |
| MCP 协议版本 | `memory-mcp.ts:21` | `2025-06-18` | `MEMORY_MCP_PROTOCOL_VERSION` |
| MCP 服务端信息 | `memory-mcp.ts:22` | `{ name: "better-agent-memory", version: "0.1.0" }` | `MEMORY_MCP_SERVER_INFO` |
| MCP 挂载点 | `apps/server/src/app.ts:219` | `/mcp/memory` | 在 oRPC catch-all 之前注册 |
| HNSW 索引 | `schema/memory.ts:136` | `vector_cosine_ops` | 通过余弦距离进行 kNN 检索 |
| 部分索引 | `schema/memory.ts:116` | `WHERE validTo IS NULL` | 热读路径（当前条目） |
