# Token 统计数据层 · 可执行实施计划（U0–U3）

> 承接 `docs/usage-stats-plan.md`（设计与决策）。本文把它落成**代码级、可按 SDD 执行**的任务，锚定当前代码的确切插入点。
>
> **现状（审查结论）**：`usage_records` 表 + migration 0037 + 5 个索引已建好（`packages/db/src/schema/usage.ts`，barrel 已 `export * from "./usage"`），但**零读零写**。dashboard 仍读旧的 `messages.usage`（chat）和 `bridge_messages.event` JSONB（bridge），未定价仍 `COALESCE→$0`。共享 `UsageSnapshot` 类型、cost-engine 的 `priced`、dual-write、`usage.aggregate`、服务端预算执行**全部未做**。

---

## 0. 先定的决策（执行前必须确认）

| # | 问题 | 决定 | 依据 |
|---|---|---|---|
| **D-1** | `usage_records.userId` 是 NOT NULL，但 chat 的 `finalizeAssistant` 拿不到 userId，且 `Session.userId` 是 `string \| null` | 把 `session.userId` 透传进 `FinalizeArgs`；**userId 为 null 的 chat 轮次不写** usage_records（老 `messages.usage` 照写，不丢数据） | `runtime.ts:216` 已加载 session；`types.ts:17 userId: string \| null` |
| **D-2** | cost 单位：chat `computeCost` 返回**分**，`usage_records.costUsd` 是**美元** | cost-engine 改为返回**美元** `{ costUsd, priced }`；chat 写老 `messages.usage.costCents` 时 `*100` 保持不变 | `cost.ts:29 return dollars * CENTS_PER_DOLLAR` |
| **D-3** | dedup key | chat = `chat:${assistantId}`；bridge = `bridge:${sessionId}:${seq}`（seq 来自 `relayStore.append`） | plan §2.1；`bridge.ts:176` |
| **D-4** | opencode `usage_update` 有损（只有汇总 `used` + `cost.amount`，无分桶） | **U1 只把 claude 的 `turn_usage` 写全**；opencode/codex/pi 待 remote-control R1 吐 canonical 事件后再进（plan §4），本计划不动适配器 normalize | `opencode-serve.ts:135`；plan §4 |
| **D-5** | chat 无 `durationMs` 追踪 | 列可空，chat 先不写 duration；bridge 的 `turn_usage.detail.durationMs` 照写 | `StreamOutcome` 无计时 |
| **D-6** | chat 没有 per-user 预算字段（`maxBudgetUsd` 目前只在 bridge token config 上） | **U3 只做 bridge 端服务端执行**；chat 预算另开小切片（需新增 user/settings 预算字段），本计划先不做 chat 预算 | `bridge-token-ports.ts:17`；grep 确认 |

> 若对 D-1/D-6 有别的偏好（例如 chat 也要预算、或 userId-null 也要落一条系统归属），执行前说，我改计划。

---

## 1. Phase U0 · 地基（不改 UI，双写开始）

**目标**：`usage_records` 有 writer；cost 带 `priced`；老路径照旧。

### T0.1 共享类型
- 新建 `packages/agent/src/usage/usage-record.ts`：`UsageTokens`（input/output/cacheRead/cacheWrite/reasoning）、`UsageSnapshot`（plan §1 形状：`model?`, `providerId?`, `tokens`, `costUsd: number|null`, `priced`, `durationMs?`, `dedupKey`, 以及 `source: "chat"|"bridge"`、`userId`、`sessionId`、`agentKind?`）。纯类型，被 chat finalize / bridge pushEvents / 新 store 共同 import。

### T0.2 cost-engine 加 `priced`
- `packages/agent/src/provider/cost.ts`：把 `computeCost(usage, pricing): number | null`（`:13`，返回分）改造/新增为返回 `{ costUsd: number | null; priced: boolean }`，单位**美元**：
  - `pricing.inputPricePerM===null || outputPricePerM===null` → `{ costUsd: null, priced: false }`（原 `:17` 的 null 分支）。
  - 否则 → `{ costUsd: dollars, priced: true }`（去掉 `*CENTS_PER_DOLLAR`）。
- 改调用点 `runtime-finalize.ts:20-21`（`withCost`）：老 `costCents` = `costUsd===null ? null : Math.round(costUsd*100)`，保持 `messages.usage.costCents` 语义；同时留住 `{costUsd, priced}` 供 snapshot。
- 更新 `packages/agent/src/provider/cost.test.ts`（6 处断言，`:18/31/43/50/56/59`）。

### T0.3 新 store `usageRecordStore`
- 新建 `packages/db/src/repositories/usage-record-store.ts`：`createUsageRecordStore(db)`，方法：
  - `insert(snapshot: UsageSnapshot)` → drizzle `insert(usageRecords).values(...).onConflictDoNothing({ target: usageRecords.dedupKey })`（**幂等**，防重复计数）。**禁用 raw SQL**（仓库规则 c94ea25），全走 query builder。
  - `aggregate(...)`（U1 用，先留桩或一并实现）。
- 注册进 `AgentServices.stores`：
  - 类型槽：`packages/api/src/services.ts` `stores` 加 `usageRecord: UsageRecordStore`（顶部加 import，参照 `usage`/`bridgeUsage`）。
  - 构造：`apps/server/src/services.ts` — import、`buildStores` 参数袋 + 返回、`assembleServices` 参数类型、`usageRecordStore: createUsageRecordStore(db)`（对齐 `usageStore` 于 `:284/:193`）。**两处必须同步改否则 TS 断**。

### T0.4 chat 双写
- 把 `session.userId` 透传进 `FinalizeArgs`（`runtime.ts:247-253` 调 `finalizeAssistant` 时补 `userId: session.userId`；`FinalizeArgs` 加字段）。
- `SessionRuntimeDeps`（`runtime.ts:49-63`）+ `buildRuntime`（`apps/server/src/services.ts:139-161`）注入 `usageRecordStore`。
- `finalizeAssistant`（`runtime-finalize.ts:32-65`）：`usage` 算完后（`:40` 之后），若 `userId != null` 且 `outcome.status !== "error"`，用 `usageRecordStore.insert` 落一条（`source:"chat"`, `dedupKey: chat:${assistantId}`, tokens 从 `MessageUsage` 映射，`costUsd/priced` 从 T0.2）。

### T0.5 bridge 双写
- `bridge.ts` `pushEvents`（`:174-186`）循环内：`event.status === "turn_usage"` 时，把 `detail`（`costUsd`/`durationMs`/`usage` snake_case：`input_tokens`/`output_tokens`/`cache_read_input_tokens`/`cache_creation_input_tokens`）映射成 `UsageSnapshot`（注意 **`cache_creation_input_tokens` → `cacheWriteTokens`**，对齐 schema），`insert`（`source:"bridge"`, `dedupKey: bridge:${sessionId}:${seq}`, `userId: context.authedBridgeToken.userId`, `agentKind` 取自 `requireOwnedBridgeSession` 拿到的 `bridgeSessions.agentKind`）。opencode/codex/pi 跳过（D-4）。

### U0 测试
- `usage-record-store.integration.test.ts`：insert + dedupKey 幂等（重复 insert 不加行）+ 基础查询。
- cost-engine 单测覆盖 `priced=false`（未知价格）与 `priced=true`。
- chat/bridge 双写各一条 happy-path（可在现有 runtime/bridge 测试里加断言：写 message 的同时 usage_records +1）。

---

## 2. Phase U1 · 统一聚合读

> **⛔ U1 前置（U0 最终评审发现的 Important bug，必须先修）：bridge `dedupKey` 不稳。**
> `bridge:${sessionId}:${seq}` 的 `seq` 是**服务端每次 relay append 时分配**的。CLI push 队列在响应丢失后会重发同一批事件 → 同一个 `turn_usage` 被追加到**新的 seq** → `onConflictDoNothing` 挡不住 → **bridge token/cost 双重计数**。U0 写-only 时无害（没人读），但 **U1 一开聚合，dashboard 第一眼就是虚高的 bridge 总额**。修法：dedupKey 改用**跨重试稳定**的标识（claude 结果里的稳定 turn/session 身份，或客户端携带 idempotency id 让 `pushEvents` 去重），**不要**用服务端 relay seq。chat 侧无此问题（`chat:${assistantId}` 稳定）。
> 次要（U1/U2 前顺手）：① chat 目前 errored 轮次也写一条（我在 T0.4 有意改为镜像 `messages.usage` 以便对账——如需按 plan 原意跳过 error，在此改）；② bridge 行 `provider_id`/`model_id` 为空（U2 "按模型" 拆分前，把 claude 的 model 从 `session_ready` 透传进 snapshot）；③ `reasoning` 语义 chat/bridge 不对称（claude 把 thinking 并进 output），聚合展示时注意。

- `usage.aggregate({ range:{from,to}, groupBy })` 新接口读 `usage_records`；`groupBy: "day"|"model"|"agent"|"session"|"source"|"bucket"`（plan §2.4），走 query builder（GROUP BY 命中 `usage_records` 已建索引）。
- dashboard hooks 切读它（**保留**老 `usage.summary` / `bridge.usageByAgentKind`）：
  - `use-usage-data.ts:57-83`、`use-local-agent-usage.ts:27-41`。
- 效果：claude chat + claude bridge 从同一张表出；`priced=false` 的行 UI 显示"未知"而非 $0（修掉 §0.4）。
- 测试：aggregate 各 groupBy 一组断言。

## 3. Phase U2 · 维度 + 图表

- 新增**按模型**、**按会话**拆分卡（会话详情页总额）；花费线已有；**放开时间范围**（用 `range:{from,to}` 取代 `windowDays∈{3,7,12}`）。
- web/admin 图表合并到 `packages/ui`：**注意**——清理阶段已确认 web 与 admin 的 `TokenChart` 是**各自独立**的组件（非同一文件），且 dashboard 的三处颜色常量语义不同（非重复）。合并需真正抽公共组件 + 保持视觉不变，属**中等重构**，可在本阶段做或再拆一个小切片。

## 4. Phase U3 · 预算 + 清理

- **bridge 服务端预算执行**（D-6）：`pushEvents` 累计本 token 的 USD（查 `usage_records` where userId/agentKind/session…），超 `token.config.maxBudgetUsd` 时向会话 `commands` relay 追加 `STOP_CONTROL_COMMAND`（复用 `endSession` 于 `:289-293` 的机制）；`startSession`（`:134-156`）已超则拒开。
- **回填**：从 `messages.usage` + `bridge_messages.event` 批量回填 `usage_records`（一次性脚本，dedupKey 幂等可重跑）。
- **停双写 + 下老查询**：删 `usage-store.ts` / `bridge-usage-store.ts` 里手写 `db.execute(sql\`…\`)` 的聚合（这正是本次审查里**你选择缓一缓的 raw-SQL 违规**——它在这里被 `usage.aggregate` 取代而自然消除，不用单独改写）。
- chat 预算：另开切片（需新增 user/settings 预算字段）。

---

## 5. 风险 & 盯住点

1. **迁移落库**：`usage_records`（migration 0037）需在共享 DB 上 `db:migrate`（非 `db:push`）。部署 DB 若没跑，写入即 500——上线前确认（[[better-agent-local-db-shared]]）。
2. **userId-null chat**（D-1）：会有 chat 轮次不进 usage_records；聚合里 chat 总额可能略低于 `messages.usage`——可接受，或后续给系统会话一个归属。
3. **opencode 有损**（D-4）：U1 汇总里 opencode 用量缺席，直到 R1 吐 canonical 事件；UI 需能表达"未覆盖"而非 0。
4. **dedup**：适配器重发/重试同一 `turn_usage` 靠 `dedupKey` 幂等挡住；`onConflictDoNothing` 是唯一防线，别绕过。
5. **双写一致性**：U0→U4 期间两套并存，回填后再切；切换前用 U1 聚合与老接口对账。

---

## 6. 执行顺序（SDD）

U0（T0.1→T0.5，每个 T 带测试）先合 → U1 → U2 → U3。U0 是"表有 writer + cost 带 priced"的最小可验证地基；U1 让 dashboard 真正吃统一表。建议每个 Phase 一个分支，dev-first（[[dev-first-workflow]]）：dev → Action 部署 test → 你验 → 合。
