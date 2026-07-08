# 聊天 UI

聊天 UI 是 Web 应用和本地 agent 终端共同使用的对话界面。它将一个流式 agent 回合渲染为有序的、带类型的块列表——文本、推理、工具调用和文件附件——并附带一个生成式 UI 层，将特定的工具结果转换为富 React 组件（推文卡片、用户卡片），而非原始 JSON。

## 架构

聊天技术栈分为共享的 UI 包和 Web 应用的应用特定粘合层：

```
apps/web                            packages/ui/components/chat
┌────────────────────┐              ┌──────────────────────────────┐
│ ChatView           │  agentClient │ Conversation                 │
│  header + picker   │ ───────────▶ │  useChat(sessionId, client)  │
│  renderToolResult  │   renderTool │  ChatScroller → ChatRow[]    │
└────────┬───────────┘   Result     │  ChatComposer                │
         │                          └──────────────────────────────┘
         ▼ renderToolResult (genui)
┌────────────────────────────────────┐
│ TOOL_RESULT_RENDERERS              │
│  x_search_tweets → TweetCardFrom…  │
│  x_followers    → UserCard[]       │
│  x_search_users → UserCard         │
│  (+ unwrapToolResult, x-schemas)   │
└────────────────────────────────────┘
```

`Conversation` (`packages/ui/src/components/chat/conversation.tsx:103`) 是可复用的核心：给定一个 `sessionId`、一个 `AgentClient` 以及可选的 `avatars`/`composerTools`/`renderToolResult`，它负责滚动容器、草稿流和输入框。`ChatView` (`apps/web/src/components/chat/chat-view.tsx:67`) 是 Web 端的封装——它添加了 agent 头部、会话选择器、新建会话按钮，并注入 Web 端的 `renderToolResult` 和 `AgentToolsMenu`。

### 块模型

一个回合会被规范化为一个有序的 `ChatBlock` 列表（`packages/ui/src/components/chat/chat-blocks.ts:22`）：

| 类型 | 来源 | 渲染方式 |
|------|--------|-------------|
| `text` | `text-delta` 事件 / 持久化的 `text` 部分 | `<Response>`（通过 Streamdown 渲染 markdown，`streaming` 时显示流式插入符） |
| `reasoning` | `reasoning-delta` 事件 / 持久化的 `reasoning` 部分 | `<Reasoning>` 折叠组件 |
| `tool` | `tool-call` + 随后的 `tool-result`（按 `callId` 匹配） | `<ToolGroup>` — 已注册时显示富视图，否则为可折叠的原始 JSON |
| `file` | 用户附件 | `<AttachmentImage>`（图片内联显示，其他文件显示为标签片） |

`appendText` (`chat-blocks.ts:54`) 将连续的同类型 delta 合并为一个块，这样流会为每一步生成一个文本块，而不是每个 token 一个块。持久化的消息由 `buildBlocks` (`chat-blocks.ts:72`) 重建，它按 `callId` 将 `tool-call` 和 `tool-result` 部分配对为一个 `ToolInvocation`，并带有 `running`/`complete`/`error` 状态。

### 流式处理管道

`useChat` (`packages/ui/src/components/chat/use-chat.ts:132`) 是 `Conversation` 背后的 hook：

1. **会话存储** — `chatSession(sessionId)` 返回一个模块级的、按会话隔离的外部存储（`committed`、`draft`、`streaming`）。导航离开不会中断回合或丢弃历史；重新挂载会重新订阅。
2. **冷启动种子** — 仅当 `committed` 和 `draft` 都为空时，`useQuery` 才会调用 `agentClient.listMessages(sessionId)` 并通过 `toChatMessage` 映射记录。一旦用户开始交互，该查询就会冻结——会话过程中没有重新抓取，因此草稿→历史记录的交接在客户端根本不存在。
3. **发送**（`use-chat.ts:64`）— `initDraft` 推入一行 `complete` 的用户记录和一行 `streaming` 的助手记录（带 `live: true`），随后 `streamPrompt` 消费 SDK 的事件流，就地修改助手草稿。
4. **提交**（`use-chat.ts:104`）— 回合完成时，实时草稿会在一次原子存储更新中移入 `committed`。没有服务端请求、没有 id 切换、没有闪烁。
5. **观察**（`chat-observe.ts`）— 如果冷启动重新加载时发现末尾的助手回合仍在服务端 `streaming`（一个游离的回合），`observePollInterval` 会每 1500ms 轮询一次历史记录，直到它完成或停滞超过 `STALL_MS`（120 秒）。

### `streamPrompt` 事件映射

`chat-stream.ts:79` 的 `applyEvent` 将每个 `RunEvent` 转换为块的变更，并通过一个 `StreamReveal` 动画器路由，该动画器对每帧的文本/推理更新做节流：

| 事件 | 动作 |
|-------|--------|
| `text-delta` | `pushDelta("text", …)` — 追加到末尾的文本块，做动画 |
| `reasoning-delta` | `pushDelta("reasoning", …)` — 追加到末尾的推理块 |
| `tool-call` | 封存当前 reveal，推入一个新的 `tool` 块（状态为 `running`） |
| `tool-result` | 按 `callId` 修补匹配的工具块 → 设置 `result`、`isError`、状态 |
| `error` | 设置助手 `status: "error"` + `errorText` |

当类型翻转（text↔reasoning）或在流结束时，会调用 `sealReveal`，冲刷动画器待处理的尾部，确保不丢失任何内容。

## 关键文件

| 文件 | 职责 |
|------|----------------|
| `apps/web/src/components/chat/chat-view.tsx` | Web 封装：头部（agent 名称、模型、会话选择器、新建/关闭），注入 `renderToolResult` + `AgentToolsMenu` |
| `apps/web/src/components/chat/use-restore-chat.ts` | 进入 `/chat` 时，重新挂载到 `?agentId` 或该标签页的上一个会话，而不是重新开始 |
| `apps/web/src/components/chat/chat-session.ts` | `loadLastChat`/`saveLastChat` — 按标签页将当前 agent+会话存入 `sessionStorage` |
| `apps/web/src/genui/tool-renderers.tsx` | `TOOL_RESULT_RENDERERS` 注册表、`renderToolResult` hook、`entry`/`listEntry` 构造器 |
| `apps/web/src/genui/tool-result-envelope.ts` | `unwrapToolResult` — 将 MCP 信封 / JSON 字符串 / 对象归一化为纯值 |
| `apps/web/src/genui/x-result-schemas.ts` | 用于归一化 X 推文/资料数据的健壮 Zod schema |
| `apps/web/src/genui/tweet-card-node.tsx` | `TweetCardFromTweet` — 推文/转推/引用渲染 |
| `apps/web/src/genui/user-card.tsx` | `UserCard` — 紧凑的 X 资料卡片 |
| `apps/web/src/genui/embedded-tweet-node.tsx` | 共享的内嵌推文原语（身份、媒体、统计、可展开文本） |
| `packages/ui/src/components/chat/conversation.tsx` | `Conversation` — 滚动容器 + 输入框接线、`useInitialSend` 延迟首次发送 |
| `packages/ui/src/components/chat/chat-row.tsx` | `ChatRow` 按角色分发；`AssistantBody`（Thinking 微光、块、已停止/错误/复制）；`UserRow`（附件 + 气泡） |
| `packages/ui/src/components/chat/chat-blocks.ts` | `ChatBlock`/`ChatMessage` 类型、`toChatMessage`、`appendText`、`messageText` |
| `packages/ui/src/components/chat/chat-stream.ts` | `streamPrompt` — RunEvent → 块变更、`StreamReveal` 动画、支持中断 |
| `packages/ui/src/components/chat/use-chat.ts` | `useChat` — 会话存储、种子与实时所有权、发送/停止、观察模式 |
| `packages/ui/src/components/chat/chat-observe.ts` | 游离回合轮询：`liveTrailingTurn`、`turnFingerprint`、停滞检测 |
| `packages/ui/src/components/chat/chat-composer.tsx` | 基于 `PromptInput` 的输入框、附件按钮、提交/停止、`toolsSlot` |
| `packages/ui/src/components/chat/chat-attachments.tsx` | `usePendingAttachments`（选择即上传）、`ChipRow`、`readyAttachments` |
| `packages/ui/src/components/chat/attachment-image.tsx` | `AttachmentImage` — 基于 object-URL 渲染令牌作用域的附件 |
| `packages/ui/src/components/chat/tool.tsx` | `ToolGroup`/`ToolInvocationView` — 富视图与纯文本渲染、`RenderToolResult` 类型 |
| `packages/ui/src/components/chat/chat-session-store.ts` | 模块级的按会话外部存储 |
| `apps/web/src/utils/chat-client.ts` | `userAgentClient(agentId)` — 从 oRPC 客户端构建一个用户平面的 `AgentClient` |

## 数据流

### 发送消息

1. `ChatComposer.submit`（`chat-composer.tsx:102`）裁剪文本，等待所有待处理附件（`readyAttachments`），然后调用 `onSend(text, ready)`。
2. `useChat.send` → `sendMessage`（`use-chat.ts:64`）：如果正在流式中则中断，设置一个 `AbortController`，`initDraft` 用户+助手记录，然后 `streamPrompt`。
3. `streamPrompt`（`chat-stream.ts:117`）迭代 `agentClient.stream(text, { sessionId, signal, attachmentIds })`。每个事件通过 `applyEvent` 修改助手草稿；`StreamReveal.onFrame` 回调调用 `setDraft([...user, {...assistant}])` 以触发 React 重新渲染。
4. 中断时，循环会在 `signal.aborted`（`chat-stream.ts:133`）处跳出，这样缓慢的流不会持续重新渲染 "Thinking…"。
5. 完成时，`sendMessage` 的 `finally` 会关闭流式状态，`store.commit()` 将草稿移入 `committed`。

### 附件生命周期

`usePendingAttachments`（`chat-attachments.tsx:16`）会**立即**通过 `agentClient.uploadAttachment(sessionId, file)`（在 `downscaleImage` 之后）上传每个选中的文件，逐项跟踪 `uploading`/`done`/`error`。只要有任一项处于 `uploading`，输入框的提交按钮就会被禁用。只有 `done` 的项（带有一个真实 `attachmentId`）才会通过 `readyAttachments` 进入发送流程。发送时，`clear()` 会撤销每个 object URL。

渲染持久化的附件使用 `AttachmentImage`（`attachment-image.tsx:42`），它调用令牌作用域的 `agentClient.getAttachment(id)` → `Blob` → object URL，在卸载时撤销。非图片文件渲染为带标签的标签片。

### 生成式 UI（工具结果）

`ChatView` 将来自 `apps/web/src/genui/tool-renderers.tsx:189` 的 `renderToolResult` 传入 `Conversation` → `ChatRow` → `ToolGroup`。一个已完成且成功的工具的渲染路径是：

1. `richResult`（`tool.tsx:56`）调用 `renderToolResult(toolName, tool.result)`。
2. `renderToolResult` 查找 `TOOL_RESULT_RENDERERS[toolName]`；未注册的名称返回 `null`（回退到普通的可折叠 JSON 块）。
3. 已注册条目的 `parse(result)` 首先通过 `unwrapToolResult`（`tool-result-envelope.ts:34`）**解包**结果——处理三种传输中的形态：
   - 一个已解析的对象/数组（客户端工具），
   - MCP 的 `{content:[{type:"text",text:"<json>"}]}` 信封（apps/mcp 的 `toolText` 辅助函数），
   - 一个裸 JSON 字符串。
   任何位置的畸形 JSON 都会解析为 `undefined`，因此 schema 的 `safeParse` 会干净地失败。
4. 解包后的值会用条目的 Zod schema 校验。`entry` 校验整个值；`listEntry` **逐元素**校验并保留有效的那些——抓取的 X 数据很杂乱，单条畸形推文不能让整个渲染变白。
5. 成功时 `render(data)` 返回 React 节点——例如推文列表用 `TweetCardFromTweet`，资料列表用 `UserCard`。

富结果会以始终可见的方式渲染（`RichToolView`，`tool.tsx:70`），原始调用折叠在下方一个不起眼的 details 折叠区里，因此该功能要展示的组件永远不会被隐藏在一个收起的开关背后。

## 设计理由

- **共享 UI 包，应用特定粘合层** — `Conversation`、`useChat`、块模型和流式处理管道都在 `packages/ui` 中，因此本地 agent 终端可以原样复用它们；只有 `ChatView` + genui 注册表是 Web 特有的。
- **实时草稿是页面停留期间的唯一真实来源** — 用户交互后种子查询会冻结，因此会话过程中不存在草稿→历史的 id 切换。这种交接只存在于冷启动（刷新）时，那时服务端是权威的。这消除了切换会导致的头像闪烁/markdown 重新解析的闪烁。
- **滚动容器使用位置键** — 聊天是只追加的，草稿行从不重排序；位置键让草稿→提交的切换成为就地更新，而非卸载/重新挂载。
- **`live` 标志 vs `status`** — 只有进行中的草稿会显示 "Thinking…" 微光；一条被重新抓取（或被停止/游离）且卡在 `streaming` 状态的消息不能永远微光，因此 `isThinking` 要求 `live === true`。
- **逐元素容错解析** — `listEntry` 校验每个元素并保留有效的那些，仅当*整体形态*错误（非数组或每个元素都失败）时才回退到原始 JSON，而不是当某一条杂项异常时。
- **在 schema 之前 `unwrapToolResult`** — MCP 工具、客户端工具和仅字符串传输各自以不同的信封到达；归一化一次意味着每个渲染器的 schema 校验的都是纯 JS 值。
- **针对游离回合的观察模式** — 回合在服务端游离运行；重新加载后没有本地流，但末尾的助手回合可能仍在流式。轮询历史记录（带停滞检测）让它持续更新，而无需伪造一个流。
- **延迟的 `useInitialSend`** — 第一条消息通过一个带清理的 `setTimeout(0)` 发送，因此输入框→聊天滑动过程中短暂的挂载/卸载会取消过期的调度，而不是中断一个已经开始的流。

## 配置

| 配置项 | 位置 | 默认值 | 说明 |
|------|----------|---------|-------|
| 观察轮询间隔 | `packages/ui/src/components/chat/chat-observe.ts:9` | 1500 ms | `OBSERVE_POLL_MS` |
| 观察停滞阈值 | `packages/ui/src/components/chat/chat-observe.ts:10` | 120_000 ms | `STALL_MS` — 停止轮询一个冻结的回合 |
| 最多渲染 genui 项数 | `apps/web/src/genui/tool-renderers.tsx:15` | 20 | `MAX_RENDERED_ITEMS`（+N more 行） |
| 工具结果截断 | `packages/ui/src/components/chat/tool.tsx:13` | 2000 字符 | 用于原始 JSON 显示的 `MAX_VALUE_CHARS` |
| 接受的图片类型 | `packages/ui/src/components/chat/chat-composer.tsx:19` | png/jpeg/webp/gif | 文件输入上的 `ACCEPT_IMAGES` |
| 推文列表工具 | `apps/web/src/genui/tool-renderers.tsx:148` | 5 个 X 工具 | `TWEET_LIST_TOOLS` 注册表键 |
| 资料列表工具 | `apps/web/src/genui/tool-renderers.tsx:156` | 2 个 X 工具 | `PROFILE_LIST_TOOLS` 注册表键 |
| 最近聊天存储键 | `apps/web/src/components/chat/chat-session.ts:1` | `last_chat` | 按标签页的 `sessionStorage` |
