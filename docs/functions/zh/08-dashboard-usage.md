# 仪表盘与用量

Token 跟踪仪表盘（`/dashboard`）可视化用户在聊天 agent 运行时和桥接连接的本地 agent 上的令牌消耗和成本。四个统计磁贴、一个双轴面积图、一个 GitHub 风格的活动热力图，以及按 agent 类型的明细，渲染在两个用量 API 上——`usage.summary`（来自助手消息的聊天令牌/成本）和 `bridge.usageByAgentKind`（来自持久化 `turn_usage` 事件的本地 agent 用量）。一个统一的 `usage_records` 表已设计（WIP），用以用单一账本取代双源聚合。

## 架构

```
┌─────────────────────────────────────────────────────────────────┐
│  apps/web — /dashboard                                          │
│    DashboardPage（windowDays 状态：3 | 7 | 12）                  │
│    ┌─────────────────────────────────────────────┐               │
│    │ StatsPanel（4 个磁贴：成本、令牌、轮次、$/轮次）             │
│    │ TokenChart（AreaChart：input+output 面积 + 成本线）         │
│    │ ActivityHeatmap（GitHub 风格 5 级网格）                     │
│    └─────────────────────────────────────────────┘               │
│    ┌─────────────────────────────────────────────┐               │
│    │ UsageOverview（按 agent 类型的彩色条）       │              │
│    └─────────────────────────────────────────────┘               │
└───────────────┬──────────────────────┬──────────────────────────┘
                │                      │
    useUsageData                  useLocalAgentUsage
    (usage.summary)               (bridge.usageByAgentKind)
                │                      │
                ▼                      ▼
┌──────────────────────────┐  ┌────────────────────────────────────┐
│  usageRouter（授权        │  │  bridgeRouter.usageByAgentKind       │
│  UserProcedure）          │  │  (userProcedure)                    │
│  summarizeUsage：         │  │  since = now - windowDays           │
│    dailySummary(userId,  │  │  bridgeUsage.usageByAgentKind(       │
│      since) → 每日行     │  │    userId, since)                    │
│    + 总计                │  │  → byKind: [{agentKind, costUsd, …}] │
└──────────┬───────────────┘  └──────────────┬─────────────────────┘
           │                                 │
           ▼                                 ▼
┌──────────────────────────┐  ┌────────────────────────────────────┐
│  UsageStore（数据库）    │  │  BridgeUsageStore（数据库）         │
│  SQL: SUM(messages.usage)│  │  SQL: SUM(bridge_messages.event     │
│  JOIN sessions（所有者） │  │    ->'detail'->>'costUsd')          │
│  GROUP BY 天             │  │  JOIN bridge_sessions（所有者）     │
│                          │  │  WHERE event->>'status'='turn_usage'│
│                          │  │  GROUP BY agent_kind                │
└──────────────────────────┘  └────────────────────────────────────┘

WIP: usage_records（统一账本，双写计划）
```

### 令牌跟踪仪表盘

`DashboardPage`（`apps/web/src/routes/dashboard.tsx:76`）持有一个 `windowDays` 状态（`3` | `7` | `12`，默认 `7`），由 `WindowToggle` 切换。`useUsageData`（`use-usage-data.ts:57`）查询 `usage.summary` 并构建连续的日期轴（`buildDayAxis`，通过 `mergeDays` 对缺失日期零填充），因此图表永远不会有间隙。`useLocalAgentUsage`（`use-local-agent-usage.ts:27`）查询 `bridge.usageByAgentKind` 并对每个 agent 类型零填充（因此即使某类型无用量，结构也始终可见）。

布局（`DashboardBody`，`dashboard.tsx:46`）：2/3 列含 `StatsPanel` + `TokenChart` + `ActivityHeatmap`，1/3 列含 `UsageOverview`。当聊天用量无每日行时渲染 `EmptyState`。

- **`StatsPanel`**（`stats-panel.tsx:52`）— 响应式网格中的四个磁贴（移动端 2 列，桌面端 4 列）：总成本（`$X.XX`）、总令牌数（K/M 格式化）、轮次、平均 $/轮次。每个磁贴在待定时显示脉冲骨架。
- **`TokenChart`**（`token-chart.tsx:149`）— 一个 Recharts `AreaChart`，左 Y 轴上两个堆叠面积（Input、Output）（令牌数，k 格式化刻度），右 Y 轴上一条成本 `Line`（$ 格式化，绿色）。渐变填充（`<linearGradient>`）将每个面积从顶部 30% 不透明度渐变到底部 0%。待定时渲染 12 柱骨架。Tooltip 使用主题变量（`--popover`、`--border`）。
- **`ActivityHeatmap`**（`activity-heatmap.tsx:204`）— GitHub 风格 5 级强度网格。`buildWeeks`（`activity-heatmap.tsx:54`）将每日轮次按周分组（周一开始），`intensityLevel`（`activity-heatmap.tsx:37`）将轮次/最大值比率映射到 0–4。通过 `document.documentElement.classList.contains("dark")` 检测亮/暗调色板（`LEVELS_LIGHT`/`LEVELS_DARK`）。悬停 tooltip 显示日期 + 轮次数。图例："Less ▢▢▢▢▢ More"。
- **`UsageOverview`**（`usage-overview.tsx:127`）— 按 agent 类型的彩色进度条。行按成本降序排列；每行显示 agent 类型图标、标签、总令牌数、成本、彩色条（宽度 = cost/maxCost），以及"% of cost · N turns"。颜色：claude `#d97757`、codex `#3b82f6`、opencode `#f59e0b`、pi `#a78bfa`。待定时显示骨架；无本地 agent 用量时显示空提示。

### 用量 API

**`usage.summary`**（`packages/api/src/routers/usage.ts:48`）— `authorizedUserProcedure`（用户 + 邀请门控）。接受 `windowDays`（3/7/12），计算 `since = now - windowDays * 86400000`，调用 `UsageStore.dailySummary(userId, since)`，并将每日行归约为总计（costCents、inputTokens、outputTokens、turns）。每日行是稀疏的（仅有用量的日期）；web 的 `mergeDays` 将它们零填充到连续轴上。

**`bridge.usageByAgentKind`**（`packages/api/src/routers/bridge-usage.ts:10`）— `userProcedure`。相同滚动窗口。调用 `BridgeUsageStore.usageByAgentKind(userId, since)`，返回 `{ windowDays, byKind: [{agentKind, costUsd, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, turns}] }`。仅窗口内有持久化 `turn_usage` 事件的类型出现；web 通过 `AGENT_KIND_OPTIONS` 零填充其余类型。

### 用量记录（WIP）

一个统一的 `usage_records` 表（`packages/db/src/schema/usage.ts:26`）被设计为用量统计的单一真相源，取代双源聚合（聊天来自 `messages.usage` JSONB，桥接来自 `bridge_messages.event` JSONB）。设计：

- **`source`**：`"chat" | "bridge"` — 聊天 agent 运行时和本地 agent 桥接都写入此处。
- **`dedupKey`**：唯一——聊天的行用 `chat:<messageId>`，桥接的行用 `bridge:<sessionId>:<seq>`。冲突时 upsert 防止重新定稿/回放导致重复计数（`uniqueIndex("usage_records_dedup_key_idx")`）。
- **`agentKind`**：聊天为 null（聊天无 agentKind；其 `providerId`/`modelId` 在下面），桥接则设置。
- **`costUsd`**：数值（USD，非分——桥接侧已是 USD；聊天的分在写入时除以 100）。`priced` 为 false 时为 null（无已知定价，因此 UI 显示"unknown"而非静默 $0）。
- **令牌桶**：`inputTokens`、`outputTokens`、`cacheReadTokens`、`cacheWriteTokens`、`reasoningTokens`。
- **索引**：dedup key（唯一）、`(userId, bucketedAt)`、`(userId, agentKind)`、`sessionId`、`(providerId, modelId)`。

**双写计划**：两个源都写入 `usage_records`（在 `dedupKey` 上 upsert），同时仪表盘从中读取，允许从两个 JSONB 聚合查询迁移。完整设计见 `docs/usage-stats-plan.md` / `docs/usage-stats-impl-plan.md`。

### 禁止原始 SQL 强制

`scripts/check-no-raw-sql.js` 是一个预提交守卫（接入 `lefthook.yml:20`），扫描 `packages/db/` 下暂存的 `.ts`/`.tsx` 文件中的 `sql\`…\`` 标签模板——drizzle 的原始 SQL 逃生舱。任何匹配都会使提交失败，并显示指向构建器 API（`db.insert().values()`、`db.select().from().where()`、`.onConflictDoUpdate()`）的消息。注释行被跳过；`sql.raw()` / `sql.identifier()`（无反引号）不受影响。

两个用量存储（`usage-store.ts`、`bridge-usage-store.ts`）目前在其聚合查询中使用 `db.execute(sql\`...\`)`——这些是先于/并存于守卫的**例外**。`usage_records` WIP 表是用归一化列 + 构建器查询取代它们计划的一部分，使数据库层保持完全基于构建器且驱动可移植。

## 关键文件

| 文件 | 职责 |
|------|----------------|
| `apps/web/src/routes/dashboard.tsx` | `DashboardPage`：windowDays 状态、header、body 布局、错误 toast |
| `apps/web/src/components/dashboard/stats-panel.tsx` | `StatsPanel`：4 个磁贴（成本、令牌、轮次、$/轮次）、K/M 格式化 |
| `apps/web/src/components/dashboard/token-chart.tsx` | `TokenChart`：Recharts AreaChart、渐变填充、双 Y 轴、骨架 |
| `apps/web/src/components/dashboard/activity-heatmap.tsx` | `ActivityHeatmap`：GitHub 风格 5 级网格、周构建器、悬停 tooltip |
| `apps/web/src/components/dashboard/usage-overview.tsx` | `UsageOverview`：按 agent 类型的彩色进度条 |
| `apps/web/src/components/dashboard/use-usage-data.ts` | `useUsageData`：usage.summary 查询 + 连续日期轴 + 零填充 |
| `apps/web/src/components/dashboard/use-local-agent-usage.ts` | `useLocalAgentUsage`：bridge.usageByAgentKind + 零填充所有类型 |
| `apps/web/src/components/dashboard/dashboard-constants.ts` | `WINDOW_OPTIONS`（3/7/12）、`DEFAULT_WINDOW`（7）、图表颜色、`CENTS_PER_DOLLAR` |
| `apps/web/src/components/dashboard/window-toggle.tsx` | `WindowToggle`：3D / 7D / 12D 分段控件 |
| `apps/web/src/components/dashboard/empty-state.tsx` | `EmptyState`："No usage yet" 带 BarChart2 图标 |
| `apps/web/src/components/dashboard/summary-card.tsx` | `SummaryCard`：图标 + 标签 + 值磁贴（待定时骨架） |
| `packages/api/src/routers/usage.ts` | `usageRouter.summary` + `summarizeUsage`（authorizedUserProcedure） |
| `packages/api/src/routers/bridge-usage.ts` | `usageByAgentKind`（userProcedure） |
| `packages/db/src/repositories/usage-store.ts` | `createUsageStore`：`dailySummary`（对 messages.usage 的 SQL 聚合） |
| `packages/db/src/repositories/bridge-usage-store.ts` | `createBridgeUsageStore`：`usageByAgentKind`（对 bridge_messages JSONB 的 SQL） |
| `packages/db/src/schema/usage.ts` | `usage_records` 表（WIP 统一账本） |
| `scripts/check-no-raw-sql.js` | 预提交守卫：拒绝 packages/db/ 中的 `sql\`…\`` |

## 数据流

### 聊天用量（仪表盘加载）

```
DashboardPage → useUsageData(windowDays)
  → orpc.usage.summary({ windowDays })
    → authorizedUserProcedure（用户 + 邀请门控）
    → summarizeUsage(usageStore, userId, windowDays)
      → since = now - windowDays * 86400000
      → usageStore.dailySummary(userId, since)
        → SQL: SUM(messages.usage->>'inputTokens'/'outputTokens'/'costCents')
          JOIN sessions ON sessions.id = messages.sessionId
          WHERE sessions.userId = userId AND role='assistant'
            AND usage IS NOT NULL AND createdAt >= since
          GROUP BY to_char(date_trunc('day', createdAt), 'YYYY-MM-DD')
      → totals = daily.reduce(sum, EMPTY_TOTALS)
      → { windowDays, daily, totals }
  → buildDayAxis(windowDays) → 连续 YYYY-MM-DD 数组
  → mergeDays(axis, raw.daily) → 零填充 DayPoint[]
  → StatsPanel / TokenChart / ActivityHeatmap 渲染
```

### 本地 agent 用量

```
UsageOverview → useLocalAgentUsage(windowDays)
  → orpc.bridge.usageByAgentKind({ windowDays })
    → userProcedure
    → bridgeUsage.usageByAgentKind(userId, since)
      → SQL: SUM(event->'detail'->>'costUsd')
        SUM(event->'detail'->'usage'->>'input_tokens'/'output_tokens'/…)
        JOIN bridge_sessions ON bridge_sessions.id = bridge_messages.sessionId
        WHERE bridge_sessions.userId = userId
          AND event->>'status' = 'turn_usage'
          AND bridge_messages.createdAt >= since
        GROUP BY bridge_sessions.agent_kind
    → { windowDays, byKind: [...] }
  → zeroRow(kind) 为 AGENT_KIND_OPTIONS 中不存在的每个类型
  → 按 costUsd 降序排序 → AgentRow（图标、标签、令牌、成本、条、%）
```

### WIP：统一 usage_records（双写，计划中）

```
聊天轮次完成:
  → 助手消息带 usage JSONB 持久化
  →（计划）upsert usage_records { dedupKey: "chat:<messageId>",
      source: "chat", userId, sessionId, providerId, modelId,
      inputTokens, outputTokens, costUsd, priced }
桥接轮次完成:
  → turn_usage 事件持久化到 bridge_messages
  →（计划）upsert usage_records { dedupKey: "bridge:<sessionId>:<seq>",
      source: "bridge", userId, sessionId, agentKind,
      inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens,
      costUsd, priced }
仪表盘读取:
  →（计划）对 usage_records 单次查询
    GROUP BY date_trunc('day', bucketedAt) 和/或 agentKind
    （取代两个 JSONB 聚合查询）
```

## 设计理由

- **两个源，一个仪表盘** — 聊天用量存在 `messages.usage`（助手消息上的 JSONB）；桥接用量存在 `bridge_messages.event`（JSONB `turn_usage` 状态事件）。仪表盘查询两者并并排渲染，而非在发布前强制迁移。
- **连续日期轴** — `buildDayAxis` + `mergeDays` 零填充缺失日期，因此图表和热力图永远不会有间隙，即使用户在某天无用量。API 返回稀疏行（仅有用量的日期）；web 填充结构。
- **零填充 agent 类型** — `useLocalAgentUsage` 零填充每个 `AGENT_KIND_OPTIONS` 类型，因此 UsageOverview 始终显示完整结构（所有四种 agent 类型），即使只有一种有用量。`isEmpty` 仅在无任何类型有任何用量时为 true。
- **分 vs USD** — 聊天用量以分存储（整数友好）；桥接 `turn_usage` 携带 `costUsd`（浮点）。仪表盘归一化：`StatsPanel` 将分除以 `CENTS_PER_DOLLAR=100`；`UsageOverview` 直接使用桥接的 USD。WIP `usage_records` 表存储 USD（写入时归一化）以统一此问题。
- **`priced` 标志** — `usage_records.priced` 在无已知定价时为 false，因此 UI 可显示"unknown"而非误导用户以为用量免费的静默 `$0`。
- **双轴图表** — 令牌（左 Y，k 格式化）和成本（右 Y，$ 格式化，绿色）共享 X 轴但有独立刻度，因此高令牌低成本日和低令牌高成本日都可读。
- **GitHub 风格热力图** — 每日轮次作为 5 级强度网格可立即扫描用量模式（连续、间隙）。亮/暗调色板检测使其在两种主题中都清晰可读。
- **`turn_usage` 作为桥接用量来源** — claude-code 归一化层每个完成的轮次发出一个 `turn_usage` 状态事件，带 `costUsd`/`numTurns`/`usage`。将其持久化到 `bridge_messages`（中继期间尽力）意味着即使中继存储将事件滚出窗口，用量也可恢复。
- **原始用量中的 snake_case** — claude 的 SDK `usage` 对象使用 snake_case（`input_tokens`、`cache_read_input_tokens`）；桥接用量 SQL 直接读取这些 JSONB 路径。`bridge-session-status.ts` 中的 `parseUsageTokens` 函数记录了这一点：读 camelCase 会使每个令牌桶永久 undefined。
- **禁止原始 SQL 守卫** — 预提交钩子强制基于构建器的数据库访问，使该层保持驱动可移植（node-postgres + PGlite）且防 SQL 注入。用量存储的 `db.execute(sql\`…\`)` 聚合是记录在案的例外；`usage_records` 是取代它们的计划。
- **聊天用量使用 `authorizedUserProcedure`** — 聊天用量需要邀请门控（未兑换邀请的客户看不到仪表盘）；桥接用量使用普通 `userProcedure`（本地 agent 用量对任何已登录用户可用，因为桥接令牌是用户范围的，无论邀请状态如何）。

## 配置

| 配置项 | 位置 | 默认值 | 备注 |
|------|----------|---------|-------|
| 窗口选项 | `dashboard-constants.ts:4` `WINDOW_OPTIONS` | `[3, 7, 12]` | 天；zod 校验 `z.union([z.literal(3), z.literal(7), z.literal(12)])` |
| 默认窗口 | `dashboard-constants.ts:7` `DEFAULT_WINDOW` | 7 | 初始 `windowDays` 状态 |
| 每美元分数 | `dashboard-constants.ts:10` `CENTS_PER_DOLLAR` | 100 | 成本显示归一化 |
| 图表颜色（input） | `dashboard-constants.ts:13` `COLOR_INPUT` | `#6366f1`（靛蓝） | AreaChart input 面积 |
| 图表颜色（output） | `dashboard-constants.ts:16` `COLOR_OUTPUT` | `#f59e0b`（琥珀） | AreaChart output 面积 |
| 图表颜色（cost） | `dashboard-constants.ts:19` `COLOR_COST` | `#10b981`（绿色） | 成本 Line + 右 Y 轴 |
| 图表高度 | `token-chart.tsx:23` `CHART_HEIGHT` | 280 | 像素 |
| 面积填充不透明度 | `token-chart.tsx:26` `AREA_FILL_OPACITY` | 0.15 | 面积填充（渐变加 0.3→0） |
| 热力图单元格大小 | `activity-heatmap.tsx:8` `CELL_SIZE` | 13 | 像素 |
| 热力图单元格间距 | `activity-heatmap.tsx:9` `CELL_GAP` | 3 | 像素 |
| 热力图亮色调色板 | `activity-heatmap.tsx:6` `LEVELS_LIGHT` | `#ebedf0 → #10b981` | 5 级（ebedf0, a7f3d0, 6ee7b7, 34d399, 10b981） |
| 热力图暗色调色板 | `activity-heatmap.tsx:7` `LEVELS_DARK` | `#30363d → #34d399` | 5 级 |
| Agent 类型颜色 | `usage-overview.tsx:18` `KIND_COLORS` | claude `#d97757`、codex `#3b82f6`、opencode `#f59e0b`、pi `#a78bfa` | 进度条 |
| 过期时间 | `apps/web/src/utils/orpc.ts:17` `STALE_TIME_MS` | 60000（60 秒） | TanStack Query 默认 |
| 每天毫秒数 | `usage.ts:5` / `bridge-usage.ts:4` | 86400000 | 窗口计算 |
| 用量记录去重 | `schema/usage.ts:58` | `dedupKey` 上的 `uniqueIndex` | upsert 目标（WIP） |
| 用量记录 TTL 索引 | `schema/usage.ts:59-65` | `(userId, bucketedAt)`、`(userId, agentKind)`、`sessionId`、`(providerId, modelId)` | 查询路径 |
| 禁止原始 SQL 模式 | `scripts/check-no-raw-sql.js:21` | `/\bsql\s*\`/` | 匹配 `sql\`…\`` 标签模板 |
| 禁止原始 SQL 范围 | `scripts/check-no-raw-sql.js:62` | `packages/db/` `.ts`/`.tsx` | 仅暂存文件 |
