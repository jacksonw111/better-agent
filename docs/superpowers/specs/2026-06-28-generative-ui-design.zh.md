# 生成式 UI 设计

> 本文是 [`2026-06-28-generative-ui-design.md`](./2026-06-28-generative-ui-design.md) 的中文翻译，以英文版为准。

**状态：** 设计 / spec（实现前）
**日期：** 2026-06-28
**作者：** jackson + Claude

## 目标

让 agent 驱动**生成式 UI**：客户端注册自己的组件库，通过 agent client 发一轮请求，agent 返回一棵声明式的 JSON UI 树，客户端用自己的组件去渲染。数据访问走客户端工具；视图作为结构化输出返回。agent 适配客户端注册的任意组件词汇表 —— 组件库是**客户端定义、可插拔的**，这契合我们多租户的 agent 平台（每个消费者自带组件）。

这份设计同时解决了头脑风暴中浮现的两个硬问题：

1. 每轮重发大组件 schema 的**逐轮 token 成本**。
2. **组件级流式**（"partial object streaming"），让 UI 渐进显现，而不是整块一次性弹出。

## 非目标（v1）

- 我们自带一套内置/标准组件库。组件库是客户端的；我们只提供契约机制，不提供组件本身。
- 双向状态绑定（AG-UI 式共享 state）。推迟 —— v1 过度设计。
- progressive disclosure / schema 检索。下文有设计，但属**第二阶段**；v1 靠 prompt 缓存 + schema 瘦身。

## 背景：已经存在的东西

本设计依赖 agent 已有的原语 —— 基础闭环**不需要新增核心 agent 能力**：

| 需求 | 现有原语 |
|---|---|
| 客户端侧数据访问 | **客户端工具**（`ClientToolDef.execute` 在本地打客户端自己的 DB；agent 发 `tool-call`，客户端执行后 `submitToolResult`） |
| "契约语言" | **`outputSchema`**（每轮传入的一份 JSON Schema） |
| JSON UI 树 | **结构化输出** —— 一个合成的 `StructuredOutput` 工具（`toolChoice:"required"`、`stopWhen` 卡在该工具上），它的调用参数就是最终 JSON |

代码中已核实的相关事实：

- `packages/agent/src/session/structured-output.ts` —— `StructuredOutput` 工具承载 `parameters: outputSchema`；模型把整份 schema（含 union 分支上的 `description`）当作该工具的参数读到。
- `packages/agent/src/session/runtime.ts` —— `StructuredOutput` 工具是**最后注入**到工具列表的。
- `packages/agent/src/tool/registry.ts` —— `buildTools(..., {cacheLastToolDef:true})` 给**最后一个**工具定义打上 `anthropic.cacheControl:{type:"ephemeral"}`。→ 组件 schema 已经落在 Anthropic 的缓存前缀里。
- `packages/agent/src/provider/cache-policy.ts` —— Anthropic 用断点（`cacheToolDefs:true`）；OpenAI/xAI 用 `promptCacheKey:sessionId`；Google 为 `none`。
- `packages/agent/src/session/runtime-drain.ts` —— `drainStream` 遍历 `result.fullStream`，目前**忽略** `tool-input-delta` 块（落进空操作的 `applyStateChunk`）。这就是 partial streaming 的挂载点。
- `packages/agent/src/session/events.ts` —— `RunEvent` 目前还没有 partial/structured delta 变体。

## 架构

```
客户端定义组件库  ──派生──▶  outputSchema（喂模型）
   （"契约语言"）      └────▶  registry + validate（渲染/校验）
        │
        ▼
client.run(用户输入, { outputSchema, tools: 数据工具, sessionId })
        │
   agent 推理 ─▶ 调数据工具（客户端打自己的 DB，回传）
             ─▶ 调 StructuredOutput（产出 UI 树）
        │
        ▼
SDK 校验树 ─▶ renderer 遍历，type→组件 ─▶ 渲染
        │
   用户交互 ─▶ action 分流：
                target:"client" → 本地 handlers[intent](payload)
                target:"agent"  → 新开一轮，agent 重渲染
```

## 契约

三个产物，一处真源。

### 1. ComponentDef —— 客户端注册的东西（"契约语言"）

```ts
interface ComponentDef {
  type: string            // 判别字段，如 "Card" | "Form" | "DataTable"
  description: string     // 选型指导 → 写进 schema 分支的 `description`
  props: ZodSchema        // typed props → 编译进 schema 分支
  children?: boolean      // 该组件是否接受子节点（容器 vs 叶子）
  actions?: string[]      // 该组件可发出的 intent 名
}
```

### 2. UINode —— agent 产出的东西（结构化输出）

```ts
type UINode = {
  id: string                                              // 模型产出，稳定渲染 key
  type: string
  props: Record<string, Json>
  children?: UINode[]                                     // 递归；JSON Schema 自引用 `$ref:"#"`
  action?: { intent: string; target: "agent" | "client"; payload?: Json }
}
```

`id` 是必填的，这样 renderer 能在 partial-stream 更新间用稳定 key（绝不用数组下标做 key）。

### 3. SDK 表面（客户端侧）

```ts
const ui = defineComponents([...defs])
//   ui.outputSchema   → 作为 outputSchema 传给 run/stream
//   ui.validate(json) → 校验 + 收窄成 UINode（仅最终树）
//   ui.components     → registry，type → ComponentDef（给 renderer 用）
```

`defineComponents` 放在框架无关的 SDK（`@jacksonw111/agent-client`）。React renderer 放在 `@better-agent/ui`。

### Schema 派生

`defineComponents` 把清单编译成一份递归的 discriminated-union JSON Schema：

- 一个 `UINode` = 在 `{type, props}` 分支上的 union，每个 `ComponentDef` 一个分支，分支的 `description` 携带该组件的选型指导。
- `children`（当组件允许时）通过 `$ref` 指向根节点定义（`$defs` + `$ref:"#/$defs/UINode"`）变成 `array of UINode`。
- `action` 是可交互分支上的可选对象。

schema 一身兼任契约**和**给模型的说明书 —— 不需要单独的提示注入通道；模型把它当作 `StructuredOutput` 工具的参数读到。

## 交互模型（A2：本地/语义分流）

每个可交互组件声明 actions；每个发出的 `action` 携带一个 `target`：

- **`target:"client"`** —— SDK 查找客户端注册的 handler（`handlers[intent](payload)`）在本地执行：导航、切换、填表、调客户端工具、改本地 state。无模型往返。
- **`target:"agent"`** —— SDK 开启后续一轮。v1 把事件格式化成一条合成 user 消息（如 `[ui-event] intent=<x> payload=<json>`），agent 的系统提示里说明这个约定。**不改线协议。** agent 重渲染一棵新树。

它落在"一次性渲染"和"全程 agent 在环"之间：廉价的本地交互留在本地，只有语义动作才花一次模型轮次。

## Token 成本兜底（分层）

组件 schema 每轮都会被重新 token 化进模型上下文（模型无状态），所以大库在长对话里很贵。两类成本，分别对待：

- **网络成本**（客户端→服务端字节）—— 次要；只有"按会话注册"能触及，且它**不会**降低模型 token 成本。
- **模型输入 token 成本** —— 贵的那个；只有上下文侧手段（缓存、检索、瘦身）能触及。

### L1 —— Prompt 缓存（基线；v1 发）

`StructuredOutput` 工具已经在 Anthropic 的 `tools→system→messages` 缓存前缀里，最后一个工具上有 ephemeral 断点。要真正命中缓存的要求：

- **确定性序列化**：以排序后的 key 输出 schema，让前缀逐轮逐字节一致。非确定性的 `JSON.stringify`/map 迭代顺序会静默打穿缓存。
- **清单稳定**：组件库在一个 session 内每轮必须完全一致。中途改动会让 tools+system+messages 全部失效。
- **TTL**：默认 5 分钟；对话有数分钟间隔时用 `ttl:"1h"`。
- **验证**：测试里断言第 1 轮后 `cache_read_input_tokens > 0`。

成本（Opus 4.8，输入 $5/MTok）：缓存读 = 0.1×，写 = 1.25×（5m）/ 2×（1h）。一份 20K-token 的 schema 跑 30 轮，从 ~$3.00（不缓存）降到 ~$0.42（缓存）—— 省 ~86%。OpenAI/xAI 靠自动前缀缓存；Google 这里没有缓存（要么接受成本，要么走 L3）。

### L2 —— Schema 瘦身（择机；低风险）

裁掉冗长的 `description`、去掉 `examples`、用 `$ref`/`$defs` 去重重复结构。把仅用于校验的约束（`minLength`、`maximum`…）从发给模型的 schema 里去掉、改在客户端强制。对网络和 token 成本都是线性帮助。

### L3 —— Progressive disclosure（第二阶段；推迟）

针对超大库。**准确性提示：** Anthropic 的 `defer_loading` / tool-search 适用于*可调用的输入工具*；我们的组件是单棵*输出*树的 union 分支，不是可调用工具。所以我们的 progressive disclosure 是**两阶段输出 schema 收窄**：

1. 发一份紧凑索引（只有组件 `type` + 一行描述），让模型先选出它需要的组件类型。
2. 用选中的分支重建一份精简的输出 schema；模型对着它产出树。

成本：多一次往返。**阈值启发式：** 当 schema ≲ 10–15K token 或组件少于 ~30–50 个时，留在 L1+L2；当 schema 超过 ~10K token **且**每轮只用到少数几个组件时切到 L3（顺带救回选型准确率 —— 这是缓存救不了的）。

## 组件级流式（partial object streaming）

随着 `StructuredOutput` 工具的参数流式到达，渐进显现 UI，而不是等最终对象。

**方案（已选）：流式解析 `StructuredOutput` 工具的 input-arg 增量。** **不要**切换到 AI SDK 的 `streamObject` —— 那是一个独立的顶层调用，会丢掉 tool-loop / `stopWhen` 的多步设计。AI SDK v5 默认就在 `fullStream` 上流式吐工具参数（`tool-input-start` → `tool-input-delta` → `tool-call`）。这也对齐 AG-UI 的 `TOOL_CALL_ARGS` 模型。

### 服务端（agent）

在 `drainStream`（`runtime-drain.ts`）里：

1. 为 `tool-input-delta` 块加一个分支，**仅当其 toolCallId 是 `StructuredOutput` 那次调用** —— 把 `inputTextDelta` 累积进 per-call buffer。（忽略其他工具的 input 增量。）
2. 对 buffer 跑 `parsePartialJson`（AI SDK 内建，或 `partial-json-parser`），得到 best-available 的 **deep-partial** 树。
3. **节流**：合并增量（如每帧 / 每 N 毫秒 emit 一次），别淹没 RunEvent 流。
4. emit 一个新的 `RunEvent`：

```ts
| { type: "structured-delta"; partial: unknown; complete: false }
```

   最终 `tool-call` 时，现有的 `done` 事件仍携带校验过的 `structured` 对象作为真源（把 partial 当作乐观的展示数据，由最终对象替换）。

### 客户端（SDK + renderer）

- SDK 把 `structured-delta` partial 转发给消费者。
- renderer 遍历 partial 树，**按 `id` 给节点做 key**，渲染已完成节点，把末尾未完成节点显示为 **skeleton** 直到它稳定（commit-on-complete）。
- UI 必须 **deep-partial 容错** —— 流式中途绝不 Zod 校验；每个字段都可能 undefined。
- 渐显动画尊重 `prefers-reduced-motion`。

### 必须处理的坑

1. 只 buffer/解析 **StructuredOutput** 的 toolCallId。
2. partial **未校验** —— 每个字段都要 guard。
3. 末尾未完成的数组元素 **drop 或 skeleton**。
4. **稳定 key + commit-on-complete** 防闪烁/重挂载。
5. **节流** emit。
6. 终值来自 `done` 事件 / 最终 `tool-call`，校验失败时可替换乐观树。

## 错误处理

- 树里**未知组件 `type`** → 渲染占位回退、跳过该节点；绝不崩。
- **树校验失败**（最终对象）→ error boundary；可选把校验错误作为后续一轮回喂 agent 让它纠正。
- **不可信输出** —— 经工具参数的结构化输出受 schema 约束、通常合法，但客户端仍把树当不可信处理：不 `eval`、限制树深度/大小、渲染前清洗字符串 prop。
- **action 没有注册 handler**（`target:"client"`）→ log + 空操作，开发态可见。

## 前端集成（apps/web —— 第一个消费者）

apps/web 是第一个消费者，也是测试载体。它承载一个**独立的生成式 UI playground 路由**（S1），让能力在隔离环境里端到端跑通；渲染器做成可复用组件，将来能直接搬进聊天（S2 的演进路径）。

已核实的 apps/web 事实（让集成贴合现有模式）：
- TanStack 文件路由（`createFileRoute`），如 `apps/web/src/routes/index.tsx`。
- `apps/web/src/utils/chat-client.ts` → `userAgentClient(agentId)` = `createUserSessionClientFrom(client, agentId)`。
- agent/session 走 React Query + `orpc`（`orpc.agents.list`、`orpc.userSessions`）。现有聊天用 `@better-agent/ui` 的 `<Conversation>` 渲染。

### 载体

- 路由 `apps/web/src/routes/genui.tsx`（在正常 web 鉴权后面）。选一个 demo agent（复用 agent grid，或一个固定配置的 agent），用 `userAgentClient(agentId)` 拿到 client，渲染 `<GenerativeUIView>`。
- `<GenerativeUIView>`：一个 prompt 框 + 实时渲染区。提交时调 `agentClient.stream(text, { sessionId, outputSchema: ui.outputSchema, tools })`，把 `structured-delta` partial（之后是最终 `structured`）喂给 renderer。

### 客户端定义的组件库（apps/web 拥有）

放在 `apps/web/src/genui/`：
- `library.tsx` —— `ComponentDef` 清单（type、description、props Zod、children、actions）**以及**每个 type 的 React 渲染实现。起步集（~12 个，有代表性又在 L3 阈值内）：`Stack`、`Card`、`Heading`、`Text`、`Badge`、`Stat`、`Image`、`List`、`Table`、`Button`、`Form`、`TextField`、`Select`。覆盖容器（children）、叶子、typed props、action 四种情况。
- `tools.ts` —— mock 数据工具（`ClientToolDef[]`）：如 `listTasks`、`getStats`、`searchItems`，返回内存数据，让 agent 先取数再渲染。可控、可复现；以后换真数据。
- `handlers.ts` —— `target:"client"` intent 的本地 handler。

`const ui = defineComponents(manifest)` 给出 `ui.outputSchema`（喂模型）和 `ui.components`（喂 renderer）。

### 渲染器（@better-agent/ui，通用 + 可复用）

`packages/ui/src/components/genui/generative-ui.tsx`：

```ts
interface GenerativeUIProps {
  tree: unknown                                              // 流式中是 partial，结束后是最终
  renderers: Record<string, React.ComponentType<NodeProps>> // type → 组件
  onAction: (action: { intent: string; target: "agent" | "client"; payload?: Json }) => void
}
```

职责：遍历树，按 `id` 给节点做 key，渲染已完成节点，末尾未完成节点显示为 skeleton（commit-on-complete），未知 `type` 回退，deep-partial 容错，尊重 `prefers-reduced-motion`。apps/web 提供 `renderers`（来自 `library.tsx`）和 `onAction`。

### Action 接线（A2）

`<GenerativeUIView>` 的 `onAction`：
- `target:"client"` → 本地跑 `handlers[intent](payload)`。
- `target:"agent"` → `agentClient.stream("[ui-event] intent=… payload=…", { sessionId, outputSchema, tools })` → 重渲染。

### Demo agent

在 admin 里配一个"Generative UI Demo" agent，系统提示让它先用数据工具取数、再用注册的组件组装成 UI 树、通过 `StructuredOutput` 返回。（没有逐轮系统提示通道；派生出的 `outputSchema` 已经强制产树 —— 提示只是提升选型质量。）

### 外部消费者

SDK（`@jacksonw111/agent-client`）保持框架无关：它出 `defineComponents` + partial 流 + `validate`。React 渲染器放在 `@better-agent/ui`（内部）。外部 SDK 消费者自己写渲染器（或将来发布一个 React 渲染器包）。

## 包边界

- `@jacksonw111/agent-client`（框架无关 SDK）：`defineComponents`、schema 派生、`validate`、partial 流转发、action 路由 helper。不含 React。
- `@better-agent/ui`（React）：通用 `<GenerativeUI>` 渲染器，消费 `renderers` + partial/最终树，含 skeleton/commit-on-complete、未知类型回退、`onAction` dispatch。
- `apps/web`（第一个消费者）：`genui/` 组件库（清单 + 渲染实现）、mock 数据工具、本地 action handler、`/genui` 路由、`<GenerativeUIView>`（流式 + partial + action 接线）。
- `packages/agent`：`structured-delta` 事件 + `drainStream` 分支 + partial-JSON 解析 + 节流。缓存断点已存在；增加确定性 schema 序列化。

## 测试策略

- **Schema 派生**：清单 → JSON Schema 往返；discriminated union 形状；通过 `$ref` 的递归 `children`；分支上有 description。
- **校验**：`ui.validate` 接受合法树、收窄类型、拒绝未知 `type`。
- **缓存**：一个测试，断言清单不变时第 2 轮 `cache_read_input_tokens > 0`（防范静默的序列化打穿）。
- **Partial streaming**：把合成的 `tool-input-delta` 序列喂进 `drainStream`；断言 partial 树单调增长、最终 `complete` 与校验对象一致；断言非 StructuredOutput 工具的增量被忽略。
- **Partial 解析**：未终结的 string/array/object buffer 解析成预期的 best-available 值；末尾未完成元素被丢弃。
- **Action 路由**：`target:"client"` 调用本地 handler；`target:"agent"` 用模板事件消息开启后续一轮。
- **Renderer**：未知 `type` → 回退；partial 更新间 key 稳定；末尾未完成节点先 skeleton 后 commit。
- **Web 冒烟（apps/web）**：`/genui` 路由能挂载；提交 prompt 后流式出一棵树、用起步组件库渲染出来；`Button`/`Form` 的 action 触发其 handler（client）或后续一轮（agent）。

## 分阶段

**第一阶段（本 spec 的核心）：**
- `ComponentDef` / `UINode` 契约 + `defineComponents` schema 派生。
- `outputSchema` + 客户端工具数据闭环（已支持；接上 UI 路径）。
- Action 路由（A2：本地/语义）。
- 通用 `<GenerativeUI>` 渲染器（`@better-agent/ui`），带未知类型回退。
- **apps/web playground**：`genui/` 组件库（~12 个）+ mock 数据工具 + 本地 handler + `/genui` 路由 + `<GenerativeUIView>` + 一个 demo agent。这就是可测载体。
- L1 缓存（确定性序列化 + 验证）+ L2 瘦身。

**第 1.5 阶段（同一波工作，高价值）：**
- 组件级流式：`structured-delta` 事件 + `drainStream` 分支 + partial 解析 + 节流 + skeleton/commit-on-complete renderer + playground 消费 partial。

**第二阶段（推迟 / 待定）：**
- L3 progressive disclosure（两阶段输出 schema 收窄）针对超大库。
- 按会话用 hash 注册清单（仅省网络成本）。
- 双向状态绑定（AG-UI 式），如果真需要的话。

## 已敲定的决定

- **用途：** 客户端定义、可插拔的组件库（多租户）。
- **第一个消费者 / 测试载体：** apps/web，一个独立的 `/genui` playground 路由（S1），渲染器做成可复用、以后能搬进聊天。
- **机制：** A —— 组件清单 → SDK 派生 schema（一处真源；描述嵌进 schema）。
- **交互：** A2 —— action 声明 `target: "agent" | "client"`；本地留本地，语义才往返。
- **流式：** 流式解析 `StructuredOutput` 工具的 input-arg 增量（不用 `streamObject`）；新增 `structured-delta` 事件；commit-on-complete renderer。
- **Token 成本：** v1 用 L1 缓存基线 + L2 瘦身；L3 progressive disclosure 推迟。
